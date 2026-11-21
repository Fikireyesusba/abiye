-- =============================================================================
-- 0049 IN-STORE SALES, CLEARING WITH AN EXPORT FIRST, CLEARING THE REVIEWED LIST
--   * In-store (walk-in) sales are recorded in the dashboard as orders with
--     channel 'in_store': paid and completed at once, stock taken, counted in
--     orders, dashboard, analytics and sales reports. A sale can be voided
--     (stock comes back). Online-shop switches do not affect the counter.
--   * Activity log and notifications can be cleared for any date range, only
--     after the same admin exported that range to Excel (last 30 minutes).
--   * "Recently reviewed" security entries can be cleared from the list (the
--     review itself stays, so the alert does not come back).
-- =============================================================================

-- ---------------------------------------------------------------- In-store sales
alter table public.orders add column channel text not null default 'online' check (channel in ('online', 'in_store'));
alter table public.orders drop constraint orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('bank_transfer', 'wallet', 'cash', 'mobile_money'));
create index orders_channel_idx on public.orders(channel, created_at desc) where channel = 'in_store';

-- Online orders need the customer's account; a counter sale has none.
create or replace function private.require_ordering_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'orders' then
    if to_jsonb(new) ->> 'channel' = 'in_store' then return new; end if;
  end if;
  new.user_id := coalesce(new.user_id, nullif(current_setting('app.ordering_user_id', true), '')::uuid);
  if new.user_id is null then
    raise exception using errcode = 'P0001', message = 'login_required';
  end if;
  return new;
end;
$$;

-- Pausing the online shop does not stop sales at the counter.
create or replace function private.order_item_service_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.orders o where o.id = new.order_id and o.channel = 'in_store') then return new; end if;
  if new.item_type = 'product' and not private.service_on('shop') then perform private.app_error('service_unavailable', 'shop'); end if;
  if new.item_type = 'printing' and not private.service_on('printing') then perform private.app_error('service_unavailable', 'printing'); end if;
  return new;
end;
$$;

-- Staff record a counter sale: [{product_id, quantity}], payment method, optional customer and discount.
create or replace function public.admin_create_instore_sale(
  p_items jsonb, p_payment_method text, p_customer_name text default null, p_customer_phone text default null,
  p_discount_etb numeric default 0, p_note text default null, p_idempotency_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key uuid := coalesce(p_idempotency_key, gen_random_uuid());
  v_existing public.orders;
  v_name text := coalesce(nullif(btrim(coalesce(p_customer_name, '')), ''), 'Walk-in customer');
  v_phone text := coalesce(nullif(btrim(coalesce(p_customer_phone, '')), ''), '+251900000000');
  v_customer uuid;
  v_order uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_discount numeric := coalesce(p_discount_etb, 0);
  v_after integer;
  r record;
  p public.products;
begin
  perform private.require_permission('orders.manage');
  select * into v_existing from public.orders where idempotency_key = v_key;
  if found then return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number, 'total_etb', v_existing.total_etb, 'replayed', true); end if;
  if p_payment_method not in ('cash', 'bank_transfer', 'mobile_money') then perform private.app_error('invalid_request', 'payment method'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then perform private.app_error('invalid_cart'); end if;
  if char_length(v_name) not between 2 and 120 then perform private.app_error('invalid_name'); end if;
  if v_phone !~ '^\+251[79][0-9]{8}$' then perform private.app_error('invalid_phone'); end if;
  if p_note is not null and char_length(p_note) > 500 then perform private.app_error('invalid_request', 'note'); end if;
  if v_discount < 0 or v_discount <> round(v_discount, 2) then perform private.app_error('invalid_amount'); end if;

  -- Lines at today's price, locked in a stable order.
  create temp table if not exists pg_temp.instore_lines (product_id uuid, qty integer) on commit drop;
  delete from pg_temp.instore_lines where true;
  insert into pg_temp.instore_lines
  select (x ->> 'product_id')::uuid, sum((x ->> 'quantity')::integer)
    from jsonb_array_elements(p_items) x group by 1;
  if exists (select 1 from pg_temp.instore_lines where qty is null or qty not between 1 and 1000) then perform private.app_error('invalid_quantity'); end if;
  for r in select l.product_id, l.qty from pg_temp.instore_lines l order by l.product_id loop
    select * into p from public.products where id = r.product_id and status <> 'archived' for update;
    if not found then perform private.app_error('product_unavailable'); end if;
    if p.track_inventory and p.stock_quantity < r.qty then perform private.app_error('insufficient_stock', p.sku); end if;
    v_subtotal := v_subtotal + p.effective_price_etb * r.qty;
  end loop;
  if v_discount >= v_subtotal then perform private.app_error('invalid_amount', 'discount'); end if;

  insert into public.customers (full_name, phone) values (v_name, v_phone)
  on conflict (phone) do update set full_name = case when excluded.phone = '+251900000000' then public.customers.full_name else excluded.full_name end
  returning id into v_customer;

  insert into public.orders (access_token_hash, tracking_code_hash, idempotency_key, customer_id, customer_name, customer_phone,
                             fulfillment_method, subtotal_etb, delivery_fee_etb, discount_etb, total_etb, status, payment_status,
                             payment_method, bank_snapshot, payment_due_at, payment_verified_at, payment_verified_by, channel)
  values (encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
          v_key, v_customer, v_name, v_phone, 'pickup', v_subtotal, 0, v_discount, v_subtotal - v_discount, 'completed', 'verified',
          p_payment_method, jsonb_build_object('in_store', true, 'note', nullif(btrim(coalesce(p_note, '')), '')), now(), now(), (select auth.uid()), 'in_store')
  returning id, order_number into v_order, v_number;

  for r in select l.product_id, l.qty from pg_temp.instore_lines l order by l.product_id loop
    select * into p from public.products where id = r.product_id;
    insert into public.order_items (order_id, item_type, product_id, name_en, name_am, sku, unit_price_etb, quantity, line_total_etb)
    values (v_order, 'product', p.id, p.name_en, p.name_am, p.sku, p.effective_price_etb, r.qty, p.effective_price_etb * r.qty);
    if p.track_inventory then
      update public.products set stock_quantity = stock_quantity - r.qty where id = p.id returning stock_quantity into v_after;
      insert into public.inventory_movements (product_id, change, quantity_after, reason, order_id, note, actor_id)
      values (p.id, -r.qty, v_after, 'order_reserved', v_order, 'In-store sale', (select auth.uid()));
    end if;
  end loop;

  perform private.audit('instore_sale', 'order', v_order::text, null,
    jsonb_build_object('order_number', v_number, 'total_etb', v_subtotal - v_discount, 'payment_method', p_payment_method),
    jsonb_build_object('order_number', v_number));
  return jsonb_build_object('order_id', v_order, 'order_number', v_number, 'total_etb', v_subtotal - v_discount, 'replayed', false);
end;
$$;
revoke all on function public.admin_create_instore_sale(jsonb, text, text, text, numeric, text, uuid) from public, anon;
grant execute on function public.admin_create_instore_sale(jsonb, text, text, text, numeric, text, uuid) to authenticated;

-- Void a counter sale (mistake / return): stock comes back, money marked refunded.
create or replace function public.admin_void_instore_sale(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.require_permission('orders.manage');
  if v_reason is null or char_length(v_reason) > 500 then perform private.app_error('note_required'); end if;
  select * into v from public.orders where id = p_order_id and channel = 'in_store' for update;
  if not found then perform private.app_error('not_found'); end if;
  if v.status = 'cancelled' then perform private.app_error('invalid_transition', 'already voided'); end if;
  perform private.release_order_stock(v.id);
  perform private.set_status_note('Sale voided: ' || v_reason);
  update public.orders set status = 'cancelled', payment_status = 'refunded', cancelled_at = now() where id = v.id;
  perform private.audit('instore_sale_voided', 'order', v.id::text, null, jsonb_build_object('reason', v_reason),
    jsonb_build_object('order_number', v.order_number, 'total_etb', v.total_etb));
end;
$$;
revoke all on function public.admin_void_instore_sale(uuid, text) from public, anon;
grant execute on function public.admin_void_instore_sale(uuid, text) to authenticated;

-- Sales report: in-store money (cash / mobile money / transfer at the counter) counted separately.
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
      'paid_by_bank', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'bank_transfer' and channel = 'online'),
      'in_store_sales', (select coalesce(sum(total_etb), 0) from paid where channel = 'in_store'),
      'in_store_count', (select count(*) from paid where channel = 'in_store'),
      'in_store_cash', (select coalesce(sum(total_etb), 0) from paid where channel = 'in_store' and payment_method = 'cash'),
      'in_store_mobile', (select coalesce(sum(total_etb), 0) from paid where channel = 'in_store' and payment_method = 'mobile_money'),
      'in_store_bank', (select coalesce(sum(total_etb), 0) from paid where channel = 'in_store' and payment_method = 'bank_transfer'),
      'paid_by_wallet', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'wallet'),
      'topups_count', (select count(*) from topups),
      'topups_amount', (select coalesce(sum(amount_etb), 0) from topups),
      'cash_in', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'bank_transfer' and channel = 'online')
                 + (select coalesce(sum(total_etb), 0) from paid where channel = 'in_store')
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
              from paid where payment_method = 'bank_transfer' and channel = 'online' group by 1, 2
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

-- ---------------------------------------------------------------- Export first, then clear
create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'orders' then perform private.require_permission('orders.view_all');
  elsif p_kind = 'activity' then perform private.require_permission('audit.view');
  elsif p_kind = 'payments' then perform private.require_permission('payments.view');
  elsif p_kind = 'sales' then perform private.require_permission('analytics.view');
  elsif p_kind = 'all' then perform private.require_permission('data.manage');
  elsif p_kind = 'notifications' then perform private.require_permission('settings.manage');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;

-- Did this admin export (at least) these days in the last 30 minutes?
create or replace function private.exported_recently(p_kind text, p_from date, p_to date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.audit_logs a
     where a.action = 'export_' || p_kind and a.actor_id = (select auth.uid()) and a.created_at > now() - interval '30 minutes'
       and (a.metadata ->> 'from') ~ '^\d{4}-\d{2}-\d{2}$' and (a.metadata ->> 'to') ~ '^\d{4}-\d{2}-\d{2}$'
       and (a.metadata ->> 'from')::date <= p_from and (a.metadata ->> 'to')::date >= p_to
       and coalesce(a.metadata ->> 'type', 'all') = 'all')
$$;

-- Activity log: clear any date range (Warsaw days, inclusive) once it was exported.
create or replace function public.admin_clear_audit_range(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_permission('audit.manage');
  if p_from is null or p_to is null or p_to < p_from or p_to > (now() at time zone 'Europe/Warsaw')::date then perform private.app_error('invalid_request', 'dates'); end if;
  if not private.exported_recently('activity', p_from, p_to) then perform private.app_error('invalid_request', 'export_first'); end if;
  perform set_config('app.audit_purge', 'on', true);
  with d as (
    delete from public.audit_logs
     where created_at >= (p_from::timestamp at time zone 'Europe/Warsaw') and created_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw')
       and action not in ('audit_cleared', 'data_reset', 'notifications_cleared') and action not like 'export\_%'
    returning 1)
  select count(*)::integer into v_count from d;
  perform set_config('app.audit_purge', '', true);
  perform private.audit('audit_cleared', 'audit', null, null, null, jsonb_build_object('from', p_from, 'to', p_to, 'deleted', v_count));
  return v_count;
end;
$$;
revoke all on function public.admin_clear_audit_range(date, date) from public, anon;
grant execute on function public.admin_clear_audit_range(date, date) to authenticated;

-- Notifications: rows for the Excel export.
create or replace function public.admin_notifications_export(p_from date, p_to date)
returns table (id bigint, created_at timestamptz, sent_at timestamptz, channel text, event_type text, status text, attempts integer,
               reference text, recipient text, last_error text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then perform private.app_error('invalid_request', 'dates'); end if;
  return query
    select o.id, o.created_at, o.sent_at, o.channel, o.event_type, o.status::text, o.attempts,
           coalesce(o.payload ->> 'order_number', o.payload ->> 'job_number', o.payload ->> 'number', o.payload ->> 'label'),
           (select u.email::text from auth.users u where u.id = o.recipient_user_id), o.last_error
      from public.notifications_outbox o
     where o.created_at >= (p_from::timestamp at time zone 'Europe/Warsaw') and o.created_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw')
     order by o.id;
end;
$$;
revoke all on function public.admin_notifications_export(date, date) from public, anon;
grant execute on function public.admin_notifications_export(date, date) to authenticated;

-- Notifications: clear a date range once exported (messages still waiting to be sent are kept).
create or replace function public.admin_clear_notifications(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_permission('settings.manage');
  if p_from is null or p_to is null or p_to < p_from or p_to > (now() at time zone 'Europe/Warsaw')::date then perform private.app_error('invalid_request', 'dates'); end if;
  if not private.exported_recently('notifications', p_from, p_to) then perform private.app_error('invalid_request', 'export_first'); end if;
  with d as (
    delete from public.notifications_outbox
     where created_at >= (p_from::timestamp at time zone 'Europe/Warsaw') and created_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw')
       and status in ('sent', 'dead', 'failed')
    returning 1)
  select count(*)::integer into v_count from d;
  perform private.audit('notifications_cleared', 'notifications', null, null, null, jsonb_build_object('from', p_from, 'to', p_to, 'deleted', v_count));
  return v_count;
end;
$$;
revoke all on function public.admin_clear_notifications(date, date) from public, anon;
grant execute on function public.admin_clear_notifications(date, date) to authenticated;

-- ---------------------------------------------------------------- Reviewed list
alter table public.security_reviews add column hidden_at timestamptz;

create or replace function public.admin_mark_security_reviewed(p_type text, p_subjects text[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.require_permission('security.manage');
  if p_type not in ('email', 'customer') or p_subjects is null or cardinality(p_subjects) <> 1 then
    perform private.app_error('invalid_request', 'review one alert at a time');
  end if;
  if p_note is not null and char_length(p_note) > 500 then perform private.app_error('invalid_request', 'note'); end if;
  insert into public.security_reviews (subject_type, subject, reviewed_at, reviewed_by, note)
  select p_type, lower(btrim(s)), now(), auth.uid(), nullif(btrim(p_note), '')
    from unnest(p_subjects) s
   where char_length(btrim(s)) between 3 and 320
  on conflict (subject_type, subject) do update set reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by, note = excluded.note, hidden_at = null;
  get diagnostics v_n = row_count;
  perform private.audit('security_reviewed', 'security', p_type, null, null,
                        jsonb_build_object('type', p_type, 'count', v_n, 'subjects', to_jsonb(p_subjects), 'note', p_note));
  return v_n;
end;
$$;


create or replace function public.admin_security_reviews(p_limit integer default 50)
returns table (subject_type text, subject text, reviewed_at timestamptz, reviewed_by_name text, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  return query
    select r.subject_type, case when r.subject_type = 'customer' then coalesce((select u.email::text from auth.users u where u.id::text = r.subject), r.subject) else r.subject end,
           r.reviewed_at, private.actor_name(r.reviewed_by), r.note
      from public.security_reviews r
     where r.hidden_at is null
     order by r.reviewed_at desc limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- Clear one entry (type + subject) or the whole "Recently reviewed" list. The review stays in force.
create or replace function public.admin_clear_reviewed_list(p_type text default null, p_subject text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_permission('security.manage');
  update public.security_reviews r set hidden_at = now()
   where r.hidden_at is null
     and (p_type is null or (r.subject_type = p_type and (r.subject = lower(btrim(p_subject))
          or (p_type = 'customer' and r.subject in (select u.id::text from auth.users u where lower(u.email) = lower(btrim(p_subject)))))));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.admin_clear_reviewed_list(text, text) from public, anon;
grant execute on function public.admin_clear_reviewed_list(text, text) to authenticated;
