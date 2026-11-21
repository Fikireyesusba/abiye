-- =============================================================================
-- 0046 WARSAW TIME, GMAIL-ONLY SIGN-UPS, PRINTING DOCUMENTS GROUP, CUSTOMER CANCEL
--   * Days (dashboard, analytics, sales reports) are counted in Europe/Warsaw
--     time (with summer time). The shop itself stays in Ethiopia (ETB, +251).
--   * New accounts only with an @gmail.com address (website_settings
--     'signup_email_domains'; local test data may add test domains).
--   * Printing group (own Telegram bot): each document of a printing job, sent
--     once its payment is approved (job moves to "printing").
--   * Customers can cancel their own order until staff approve the payment.
-- =============================================================================

-- ---------------------------------------------------------------- Warsaw time
create or replace function public.admin_dashboard_stats(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_all       boolean := private.has_permission('orders.view_all');
  v_assigned  boolean := private.has_permission('orders.view_assigned');
  v_revenue   boolean := private.has_permission('analytics.view');
  v_days      integer := greatest(1, least(coalesce(p_days, 14), 90));
  v_today     date := (now() at time zone 'Europe/Warsaw')::date;
  v_result    jsonb;
begin
  perform private.require_permission('dashboard.view');

  with visible as (
    -- An order counts once the customer has paid: receipt waiting for approval, verified, or refunded.
    select o.* from public.orders o
    where (v_all or (v_assigned and o.assigned_to = v_uid))
      and o.payment_status in ('pending_verification', 'verified', 'refunded')
  )
  select jsonb_build_object(
    'orders_total', (select count(*) from visible),
    'orders_today', (select count(*) from visible where (created_at at time zone 'Europe/Warsaw')::date = v_today),
    'awaiting_processing', (select count(*) from visible where status in ('confirmed', 'processing')),
    'awaiting_payment', (select count(*) from visible where status in ('awaiting_payment', 'payment_rejected')),
    'pending_payments', case when private.has_permission('payments.view')
        then (select count(*) from public.payment_submissions where status = 'pending') end,
    'products_active', case when private.has_permission('products.view')
        then (select count(*) from public.products where status = 'active') end,
    'low_stock', case when private.has_permission('products.view') or private.has_permission('inventory.manage')
        then (select count(*) from public.products where status = 'active' and track_inventory
              and stock_quantity > 0 and stock_quantity <= low_stock_threshold) end,
    'out_of_stock', case when private.has_permission('products.view') or private.has_permission('inventory.manage')
        then (select count(*) from public.products where status = 'active' and track_inventory and stock_quantity = 0) end,
    'printing_open', case when private.has_permission('printing.view')
        then (select count(*) from public.printing_jobs where status in ('awaiting_quote', 'payment_verification', 'printing', 'ready')) end,
    'revenue_verified_total', case when v_revenue
        then (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified') end,
    'revenue_verified_period', case when v_revenue
        then (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified'
              and (payment_verified_at at time zone 'Europe/Warsaw')::date > v_today - v_days) end,
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'day', d.day,
               'orders', (select count(*) from visible v where (v.created_at at time zone 'Europe/Warsaw')::date = d.day),
               'revenue', case when v_revenue then (
                   select coalesce(sum(o.total_etb), 0) from public.orders o
                    where o.payment_status = 'verified'
                      and (o.payment_verified_at at time zone 'Europe/Warsaw')::date = d.day) end)
             order by d.day)
      from (select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as day) d
    )
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_analytics(p_from date, p_to date, p_bucket text default 'day')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_money  boolean := private.has_permission('analytics.view');
  v_bucket text := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end;
  v_from   timestamptz;
  v_to     timestamptz;
  v_result jsonb;
begin
  if not (v_money or private.has_permission('reports.operational')) then
    perform private.app_error('forbidden', 'analytics.view');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    perform private.app_error('invalid_request');
  end if;
  v_from := p_from::timestamp at time zone 'Europe/Warsaw';
  v_to   := (p_to + 1)::timestamp at time zone 'Europe/Warsaw';

  with
  placed as (select * from public.orders where created_at >= v_from and created_at < v_to),
  paid as (select * from public.orders where payment_status = 'verified'
                    and payment_verified_at >= v_from and payment_verified_at < v_to),
  paid_items as (
    select i.*, p.category_id, coalesce(c.parent_id, c.id) as top_category
      from public.order_items i join paid o on o.id = i.order_id
      left join public.products p on p.id = i.product_id
      left join public.categories c on c.id = p.category_id),
  buckets as (
    select generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval)::date as b)
  select jsonb_build_object(
    'money', v_money,
    'bucket', v_bucket,
    'totals', jsonb_build_object(
      'orders_placed', (select count(*) from placed),
      'orders_paid', (select count(*) from paid),
      'orders_expired', (select count(*) from placed where status = 'expired'),
      'orders_cancelled', (select count(*) from placed where status = 'cancelled'),
      'items_sold', (select coalesce(sum(quantity), 0) from paid_items where item_type = 'product'),
      'revenue', case when v_money then (select coalesce(sum(total_etb), 0) from paid) end,
      'products_revenue', case when v_money then (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'product') end,
      'printing_revenue', case when v_money then (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'printing') end,
      'delivery_fees', case when v_money then (select coalesce(sum(delivery_fee_etb), 0) from paid) end,
      'discounts', case when v_money then (select coalesce(sum(discount_etb), 0) from paid) end,
      'average_order', case when v_money then (select round(avg(total_etb), 2) from paid) end),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', bk.b,
               'orders', (select count(*) from placed o
                           where date_trunc(v_bucket, (o.created_at at time zone 'Europe/Warsaw'))::date = bk.b),
               'paid', (select count(*) from paid o
                         where date_trunc(v_bucket, (o.payment_verified_at at time zone 'Europe/Warsaw'))::date = bk.b),
               'revenue', case when v_money then (select coalesce(sum(o.total_etb), 0) from paid o
                         where date_trunc(v_bucket, (o.payment_verified_at at time zone 'Europe/Warsaw'))::date = bk.b) end)
             order by bk.b), '[]'::jsonb)
        from buckets bk),
    'by_category', (
      select coalesce(jsonb_agg(x order by x.qty desc), '[]'::jsonb) from (
        select coalesce(c.name_en, case when pi.item_type = 'printing' then 'Printing services' else 'Other' end) as name,
               coalesce(c.department::text, case when pi.item_type = 'printing' then 'printing' end) as department,
               sum(pi.quantity) as qty,
               case when v_money then sum(pi.line_total_etb) end as revenue
          from paid_items pi left join public.categories c on c.id = pi.top_category
         group by 1, 2) x),
    'best_sellers', (
      select coalesce(jsonb_agg(x order by x.qty desc, x.name), '[]'::jsonb) from (
        select pi.product_id, max(pi.name_en) as name, max(pi.sku) as sku, sum(pi.quantity) as qty,
               case when v_money then sum(pi.line_total_etb) end as revenue
          from paid_items pi where pi.item_type = 'product'
         group by pi.product_id
         order by sum(pi.quantity) desc
         limit 10) x),
    'statuses', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
        from (select status::text, count(*) as n from placed group by 1) s),
    'fulfillment', (
      select coalesce(jsonb_object_agg(fulfillment_method, n), '{}'::jsonb)
        from (select fulfillment_method::text, count(*) as n from placed group by 1) s),
    'promotions', (
      select coalesce(jsonb_agg(x order by x.orders desc), '[]'::jsonb) from (
        select pr.title_en as name, pr.code::text as code, count(*) as orders,
               case when v_money then sum(o.discount_etb) end as discount
          from placed o join public.promotions pr on pr.id = o.promotion_id
         where o.status not in ('expired', 'cancelled')
         group by pr.id) x),
    'inventory', jsonb_build_object(
      'active_products', (select count(*) from public.products where status = 'active'),
      'tracked', (select count(*) from public.products where status = 'active' and track_inventory),
      'out_of_stock', (select count(*) from public.products where status = 'active' and track_inventory and stock_quantity <= 0),
      'low_stock', (select count(*) from public.products where status = 'active' and track_inventory
                      and stock_quantity > 0 and stock_quantity <= low_stock_threshold),
      'units_in_stock', (select coalesce(sum(stock_quantity), 0) from public.products where status = 'active' and track_inventory),
      'stock_value', case when v_money then (select coalesce(sum(stock_quantity * coalesce(sale_price_etb, price_etb)), 0)
                       from public.products where status = 'active' and track_inventory) end)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_sales_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v jsonb;
begin
  perform private.require_permission('analytics.view');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform private.app_error('invalid_request');
  end if;
  v_from := p_from::timestamp at time zone 'Europe/Warsaw';
  v_to   := (p_to + 1)::timestamp at time zone 'Europe/Warsaw';

  with
  placed as (select * from public.orders where created_at >= v_from and created_at < v_to),
  paid as (select * from public.orders where payment_verified_at >= v_from and payment_verified_at < v_to
             and payment_status in ('verified', 'refunded')),
  paid_items as (select i.* from public.order_items i join paid o on o.id = i.order_id),
  topups as (select * from public.wallet_topups where status = 'verified' and reviewed_at >= v_from and reviewed_at < v_to),
  cancelled_paid as (
    select o.*, h.created_at as cancelled_on from public.orders o
      join lateral (select created_at from public.order_status_history
                     where order_id = o.id and to_status = 'cancelled' order by id desc limit 1) h on true
     where o.status = 'cancelled' and o.payment_verified_at is not null
       and h.created_at >= v_from and h.created_at < v_to),
  wallet_refunds as (select * from public.wallet_ledger where kind = 'refund' and created_at >= v_from and created_at < v_to),
  days as (select generate_series(p_from::timestamp, p_to::timestamp, interval '1 day')::date as d),
  addis as (select o.*, (o.payment_verified_at at time zone 'Europe/Warsaw')::date as d from paid o)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', jsonb_build_object(
      'orders_placed', (select count(*) from placed),
      'orders_paid', (select count(*) from paid),
      'sales', (select coalesce(sum(total_etb), 0) from paid),
      'products_sales', (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'product'),
      'printing_sales', (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'printing'),
      'delivery_fees', (select coalesce(sum(delivery_fee_etb), 0) from paid),
      'discounts', (select coalesce(sum(discount_etb), 0) from paid),
      'average_order', (select coalesce(round(avg(total_etb), 2), 0) from paid),
      'paid_by_bank', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'bank_transfer'),
      'paid_by_wallet', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'wallet'),
      'topups_count', (select count(*) from topups),
      'topups_amount', (select coalesce(sum(amount_etb), 0) from topups),
      'cash_in', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'bank_transfer')
                 + (select coalesce(sum(amount_etb), 0) from topups),
      'cancelled_after_payment_count', (select count(*) from cancelled_paid),
      'cancelled_after_payment_bank', (select coalesce(sum(total_etb), 0) from cancelled_paid where payment_method = 'bank_transfer'),
      'wallet_refunds', (select coalesce(sum(amount_etb), 0) from wallet_refunds)),
    'by_bank', (
      select coalesce(jsonb_agg(x order by x ->> 'bank', x ->> 'account'), '[]'::jsonb) from (
        select jsonb_build_object('bank', bank, 'account', account,
                 'orders', sum(orders), 'orders_amount', sum(orders_amount), 'topups', sum(topups), 'topups_amount', sum(topups_amount),
                 'total', sum(orders_amount) + sum(topups_amount)) as x
          from (
            select coalesce(bank_snapshot ->> 'bank_name', '—') as bank, coalesce(bank_snapshot ->> 'account_number', '—') as account,
                   count(*) as orders, sum(total_etb) as orders_amount, 0 as topups, 0::numeric as topups_amount
              from paid where payment_method = 'bank_transfer' group by 1, 2
            union all
            select coalesce(bank_snapshot ->> 'bank_name', '—'), coalesce(bank_snapshot ->> 'account_number', '—'), 0, 0, count(*), sum(amount_etb)
              from topups group by 1, 2) u
         group by bank, account) t),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', dd.d,
               'placed', (select count(*) from placed o where (o.created_at at time zone 'Europe/Warsaw')::date = dd.d),
               'paid', (select count(*) from addis a where a.d = dd.d),
               'sales', (select coalesce(sum(a.total_etb), 0) from addis a where a.d = dd.d),
               'bank', (select coalesce(sum(a.total_etb), 0) from addis a where a.d = dd.d and a.payment_method = 'bank_transfer'),
               'wallet', (select coalesce(sum(a.total_etb), 0) from addis a where a.d = dd.d and a.payment_method = 'wallet'),
               'topups', (select coalesce(sum(t.amount_etb), 0) from topups t where (t.reviewed_at at time zone 'Europe/Warsaw')::date = dd.d))
             order by dd.d), '[]'::jsonb) from days dd),
    'by_staff', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'payments', n, 'amount', amount) order by n desc), '[]'::jsonb) from (
        select private.actor_name(payment_verified_by) as name, count(*) as n, sum(total_etb) as amount
          from paid where payment_method = 'bank_transfer' group by payment_verified_by) s),
    'top_products', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name_en, 'sku', sku, 'quantity', q, 'amount', amount) order by q desc, amount desc), '[]'::jsonb) from (
        select name_en, sku, sum(quantity) as q, sum(line_total_etb) as amount
          from paid_items where item_type = 'product' group by name_en, sku order by 3 desc, 4 desc limit 15) tp),
    'cancelled_after_payment', (
      select coalesce(jsonb_agg(jsonb_build_object('order_number', c.order_number, 'total', c.total_etb, 'method', c.payment_method,
               'cancelled_at', c.cancelled_on, 'customer', c.customer_name) order by c.cancelled_on), '[]'::jsonb)
        from cancelled_paid c)
  ) into v;
  return v;
end;
$$;

create or replace function private.feed_security_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_score integer;
begin
  if not private.feed_on('security') then return null; end if;
  if new.kind = 'admin_login_success' then
    v_key := 'feed:sec:' || new.id;   -- every admin sign-in is reported on its own
  else
    v_key := 'feed:sec:' || new.kind || ':' || coalesce(lower(new.email), '-') || ':' || coalesce(new.ip_hash, '-') || ':' || floor(extract(epoch from new.created_at) / 300)::bigint;
    -- First message already sent: further repeats in the same 5 minutes collect in one follow-up message.
    if exists (select 1 from public.notifications_outbox where dedupe_key = v_key and status <> 'pending') then
      v_key := v_key || ':more';
    end if;
  end if;
  insert into public.notifications_outbox (channel, event_type, dedupe_key, payload)
  values ('telegram', 'security_event', v_key, jsonb_build_object(
    'kind', new.kind, 'email', new.email, 'account', private.actor_name(new.user_id),
    'is_staff', exists (select 1 from public.profiles p where p.id = new.user_id),
    'network', left(new.ip_hash, 10), 'device', left(new.user_agent, 160), 'details', new.metadata,
    'at', new.created_at, 'repeats', 1))
  on conflict (dedupe_key) do update
     set payload = jsonb_set(public.notifications_outbox.payload, '{repeats}',
                             to_jsonb(coalesce((public.notifications_outbox.payload ->> 'repeats')::int, 1) + 1))
   where public.notifications_outbox.status = 'pending';

  -- 🚨 once per email per day when it becomes high-risk (not blocked, not reviewed).
  if new.email is not null and new.kind <> 'admin_login_success' and not private.email_is_blocked(new.email) then
    v_score := private.email_risk_24h(new.email);
    if v_score >= 6 then
      insert into public.notifications_outbox (channel, event_type, dedupe_key, payload)
      values ('telegram', 'security_alert', 'feed:alert:' || lower(new.email) || ':' || (now() at time zone 'Europe/Warsaw')::date,
              jsonb_build_object('email', new.email, 'score', v_score, 'last_kind', new.kind, 'network', left(new.ip_hash, 10),
                                 'has_account', exists (select 1 from auth.users u where lower(u.email) = lower(new.email)),
                                 'is_staff', exists (select 1 from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(new.email)),
                                 'at', new.created_at))
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return null;
end;
$$;


-- ---------------------------------------------------------------- Gmail only
insert into public.website_settings (key, value, is_public)
values ('signup_email_domains', '{"domains": ["gmail.com"]}', false)
on conflict (key) do nothing;

create or replace function private.signup_domain_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(split_part(btrim(coalesce(p_email, '')), '@', 2)) in (
    select lower(jsonb_array_elements_text(coalesce(private.setting('signup_email_domains') -> 'domains', '["gmail.com"]'::jsonb))))
$$;
grant execute on function private.signup_domain_allowed(text) to authenticated, service_role;

-- Every new account (customer sign-up, invitation, staff) — existing accounts are not affected.
create or replace function private.refuse_other_email_domains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.signup_domain_allowed(new.email) then
    raise exception using errcode = 'P0001', message = 'email_domain_not_allowed';
  end if;
  return new;
end;
$$;
drop trigger if exists refuse_other_email_domains on auth.users;
create trigger refuse_other_email_domains before insert on auth.users
  for each row execute function private.refuse_other_email_domains();

-- For the website's forms (a friendly message before trying to create the account).
create or replace function public.signup_email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.signup_domain_allowed(p_email)
$$;
revoke all on function public.signup_email_allowed(text) from public;
grant execute on function public.signup_email_allowed(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- Printing documents group
create or replace function private.telegram_group(p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event in ('security_event', 'security_alert', 'admin_action', 'security_test') then 'security'
    when p_event in ('low_stock', 'out_of_stock', 'stock_test') then 'stock'
    when p_event in ('receipt_record', 'receipts_test') then 'receipts'
    when p_event in ('printing_document', 'printing_test') then 'printing'
    else 'orders'
  end
$$;

-- Payment approved (job moves to "printing"): every document of the job, one message each.
create or replace function private.printing_documents_on_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_i integer := 0;
  f record;
begin
  if new.status <> 'printing' or old.status = 'printing' then return null; end if;
  select count(*) into v_total from public.printing_files where job_id = new.id and deleted_at is null;
  for f in select * from public.printing_files where job_id = new.id and deleted_at is null order by created_at, id loop
    v_i := v_i + 1;
    perform private.enqueue_notification('printing_document', 'printing_document:' || f.id,
      jsonb_build_object('job_id', new.id, 'job_number', new.job_number, 'file_name', f.original_name, 'mime', f.mime_type,
        'size_bytes', f.size_bytes, 'pages', f.page_count, 'n', v_i, 'of', v_total,
        'customer', new.customer_name, 'phone', new.customer_phone, 'color_mode', new.color_mode, 'paper_size', new.paper_size,
        'sides', new.sides, 'copies', new.copies, 'page_count', new.page_count, 'total_etb', new.total_etb,
        'fulfillment', new.fulfillment_method, 'notes', left(new.customer_notes, 300)),
      'printing-files', f.storage_path);
  end loop;
  return null;
end;
$$;
drop trigger if exists printing_documents_on_paid on public.printing_jobs;
create trigger printing_documents_on_paid after update of status on public.printing_jobs
  for each row execute function private.printing_documents_on_paid();

create or replace function public.admin_queue_group_test(p_group text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  if p_group not in ('stock', 'receipts', 'printing') then perform private.app_error('invalid_request'); end if;
  perform private.enqueue_notification(p_group || '_test', p_group || '_test:' || gen_random_uuid(),
    jsonb_build_object('requested_by', private.actor_name(auth.uid()), 'requested_at', now()));
end;
$$;

-- Documents for a printing group that was never set up are dropped after 2 days.
create or replace function public.purge_stale_telegram_feed()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.notifications_outbox
   where channel = 'telegram' and status in ('pending', 'failed', 'dead')
     and event_type in ('security_event', 'security_alert', 'admin_action', 'notification_copy', 'receipt_record', 'stock_test', 'receipts_test',
                        'printing_document', 'printing_test')
     and created_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------- Customer cancels
create or replace function public.customer_cancel_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_note text;
begin
  if not private.is_active_customer() then perform private.app_error('login_required'); end if;
  select * into v_order from public.orders where id = p_order_id and user_id = (select auth.uid()) for update;
  if not found then perform private.app_error('not_found'); end if;
  -- Until staff approve the payment (a verified / balance-paid order is handled by the shop).
  if v_order.status not in ('awaiting_payment', 'pending_verification', 'payment_rejected') or v_order.payment_status in ('verified', 'refunded') then
    perform private.app_error('invalid_transition', v_order.status::text || '->cancelled');
  end if;
  v_note := 'Cancelled by the customer' || coalesce(': ' || v_reason, '');
  perform private.release_order_stock(v_order.id);
  -- A receipt still waiting for approval is closed (kept for the records).
  update public.payment_submissions
     set status = 'rejected', reviewed_at = now(), review_note = 'Order cancelled by the customer'
   where order_id = v_order.id and status = 'pending';
  update public.printing_jobs set status = 'cancelled'
   where order_id = v_order.id and status not in ('completed', 'cancelled');
  perform private.set_status_note(v_note);
  update public.orders set status = 'cancelled', cancelled_at = now() where id = v_order.id;
  perform private.audit('order_status', 'order', v_order.id::text,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', 'cancelled', 'note', v_note),
    jsonb_build_object('by', 'customer', 'order_number', v_order.order_number));
end;
$$;
revoke all on function public.customer_cancel_order(uuid, text) from public, anon;
grant execute on function public.customer_cancel_order(uuid, text) to authenticated;
