-- 0054:
--   * Support tickets: closed tickets disappear from the customer app 24 h after closing;
--     a ticket waiting for the customer's answer closes automatically after 48 h;
--     customers rate closed / resolved tickets 1–5 stars (optional comment).
--   * Unpaid orders are released after 30 minutes (setting "payment_window_minutes");
--     overdue orders are released before every new order, so the first to pay gets the item.
--   * Exports: customers, products, wallet, printing, support (recorded); closed tickets can be
--     cleared for a date range after they were exported.

-- ============================================================ Tickets: rating, 24 h visibility, 48 h auto-close
alter table public.support_tickets add column if not exists rating smallint check (rating between 1 and 5);
alter table public.support_tickets add column if not exists rating_comment text check (char_length(rating_comment) <= 500);
alter table public.support_tickets add column if not exists rated_at timestamptz;

drop policy if exists support_tickets_own_read on public.support_tickets;
create policy support_tickets_own_read on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_customer())
         and (status <> 'closed' or closed_at > now() - interval '24 hours'));
drop policy if exists support_messages_own_read on public.support_ticket_messages;
create policy support_messages_own_read on public.support_ticket_messages for select to authenticated
  using (not internal and (select private.is_active_customer())
         and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid())
                       and (t.status <> 'closed' or t.closed_at > now() - interval '24 hours')));

-- Customer replies only to tickets they can still see.
create or replace function public.customer_reply_ticket(p_ticket_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.support_tickets;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not private.is_active_customer() then perform private.app_error('login_required'); end if;
  select * into v_t from public.support_tickets where id = p_ticket_id and user_id = (select auth.uid()) for update;
  if not found or (v_t.status = 'closed' and v_t.closed_at <= now() - interval '24 hours') then perform private.app_error('not_found'); end if;
  if v_t.status = 'closed' then perform private.app_error('invalid_transition', 'closed'); end if;
  if char_length(v_body) < 1 or char_length(v_body) > 3000 then perform private.app_error('invalid_request', 'message'); end if;
  if (select count(*) from public.support_ticket_messages where ticket_id = v_t.id and not from_staff and created_at > now() - interval '1 hour') >= 20 then
    perform private.app_error('rate_limited');
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, from_staff, body) values (v_t.id, (select auth.uid()), false, v_body);
  update public.support_tickets
     set last_message_at = now(),
         status = case when status in ('waiting_customer', 'resolved') then 'open' else status end,
         resolved_at = case when status = 'resolved' then null else resolved_at end
   where id = v_t.id;
  perform private.enqueue_notification('support_reply', 'support_reply:' || v_t.id || ':' || (select max(id) from public.support_ticket_messages where ticket_id = v_t.id),
    jsonb_build_object('ticket_id', v_t.id, 'number', v_t.ticket_number, 'subject', v_t.subject, 'message', left(v_body, 1500),
      'user_id', private.member_of(v_t.user_id), 'customer', (select full_name from public.customer_accounts where id = v_t.user_id)));
end;
$$;

-- 1–5 stars once the ticket is resolved or closed.
create or replace function public.customer_rate_ticket(p_ticket_id uuid, p_rating integer, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.support_tickets;
begin
  if not private.is_active_customer() then perform private.app_error('login_required'); end if;
  if p_rating is null or p_rating not between 1 and 5 then perform private.app_error('invalid_request', 'rating'); end if;
  select * into v_t from public.support_tickets where id = p_ticket_id and user_id = (select auth.uid()) for update;
  if not found or (v_t.status = 'closed' and v_t.closed_at <= now() - interval '24 hours') then perform private.app_error('not_found'); end if;
  if v_t.status not in ('resolved', 'closed') then perform private.app_error('invalid_transition', v_t.status); end if;
  if v_t.rating is not null then perform private.app_error('already_reviewed'); end if;
  update public.support_tickets
     set rating = p_rating, rating_comment = nullif(left(btrim(coalesce(p_comment, '')), 500), ''), rated_at = now()
   where id = v_t.id;
  perform private.audit('ticket_rated', 'support_ticket', v_t.id::text, null, jsonb_build_object('rating', p_rating), jsonb_build_object('ticket_number', v_t.ticket_number));
end;
$$;
revoke all on function public.customer_rate_ticket(uuid, integer, text) from public, anon;
grant execute on function public.customer_rate_ticket(uuid, integer, text) to authenticated;

-- Waiting for the customer for 48 h without an answer → closed (run on page loads and daily).
create or replace function public.close_stale_tickets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select * from public.support_tickets
            where status = 'waiting_customer' and last_message_at < now() - interval '48 hours'
            order by last_message_at limit 200 for update skip locked loop
    insert into public.support_ticket_messages (ticket_id, author_id, from_staff, body)
    values (r.id, null, true, 'Closed automatically: no answer within 48 hours. Open a new report if you still need help.');
    update public.support_tickets set status = 'closed', closed_at = now(), last_message_at = now() where id = r.id;
    perform private.audit('ticket_auto_closed', 'support_ticket', r.id::text, jsonb_build_object('status', r.status), jsonb_build_object('status', 'closed'),
      jsonb_build_object('ticket_number', r.ticket_number, 'reason', 'no answer within 48 hours'));
    perform private.enqueue_customer_email('customer_ticket_update', 'ticket:' || r.id || ':autoclose', r.user_id,
      jsonb_build_object('ticket_id', r.id, 'number', r.ticket_number, 'subject', r.subject, 'status', 'closed',
        'message', 'Closed automatically: no answer within 48 hours.'));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.close_stale_tickets() from public, anon;
grant execute on function public.close_stale_tickets() to authenticated, service_role;

-- Staff list: also details, rating and closing time.
drop function if exists public.admin_support_tickets(text, text, timestamptz, timestamptz, integer);
create function public.admin_support_tickets(
  p_status text default null, p_search text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 300)
returns table (
  id uuid, ticket_number text, user_id uuid, member_id text, customer_name text, email text, category text, order_id uuid, order_number text,
  subject text, status text, assigned_name text, created_at timestamptz, last_message_at timestamptz, messages bigint,
  details text, rating smallint, rating_comment text, resolved_at timestamptz, closed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('support.view');
  return query
    select t.id, t.ticket_number, t.user_id, c.member_id, c.full_name, u.email::text, t.category, t.order_id, t.order_number,
           t.subject, t.status, private.actor_name(t.assigned_to), t.created_at, t.last_message_at,
           (select count(*) from public.support_ticket_messages m where m.ticket_id = t.id),
           t.details, t.rating, t.rating_comment, t.resolved_at, t.closed_at
      from public.support_tickets t
      join auth.users u on u.id = t.user_id
      left join public.customer_accounts c on c.id = t.user_id
     where (p_status is null or t.status = p_status)
       and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to)
       and (v_q is null or t.ticket_number ilike '%' || v_q || '%' or t.subject ilike '%' || v_q || '%' or t.details ilike '%' || v_q || '%'
            or c.member_id = v_q or c.full_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%' or t.order_number ilike '%' || v_q || '%')
     order by case t.status when 'open' then 0 when 'in_progress' then 1 when 'waiting_customer' then 2 else 3 end, t.last_message_at desc
     limit greatest(1, least(coalesce(p_limit, 300), 5000));
end;
$$;
revoke all on function public.admin_support_tickets(text, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_support_tickets(text, text, timestamptz, timestamptz, integer) to authenticated;

-- Closed / resolved tickets of a date range (opened in it) are deleted — only after they were exported.
create or replace function public.admin_clear_tickets(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_permission('support.manage');
  if p_from is null or p_to is null or p_to < p_from or p_to > (now() at time zone 'Europe/Warsaw')::date then perform private.app_error('invalid_request', 'dates'); end if;
  if not private.exported_recently('support', p_from, p_to) then perform private.app_error('invalid_request', 'export_first'); end if;
  with d as (
    delete from public.support_tickets
     where created_at >= (p_from::timestamp at time zone 'Europe/Warsaw') and created_at < ((p_to + 1)::timestamp at time zone 'Europe/Warsaw')
       and status in ('closed', 'resolved')
    returning 1)
  select count(*)::integer into v_count from d;
  perform private.audit('tickets_cleared', 'support_ticket', null, null, null, jsonb_build_object('from', p_from, 'to', p_to, 'deleted', v_count));
  return v_count;
end;
$$;
revoke all on function public.admin_clear_tickets(date, date) from public, anon;
grant execute on function public.admin_clear_tickets(date, date) to authenticated;

create or replace function private.activity_category(p_action text, p_entity_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_entity_type in ('security', 'audit', 'data', 'export') or p_action like 'export\_%' or p_action = 'user_signed_out' then 'security'
    when p_entity_type = 'payment_submission' or p_action like 'topup\_%' or p_action like 'payment\_%' or p_action = 'wallet_adjusted' then 'payments'
    when p_entity_type in ('order', 'printing_job') then 'orders'
    when p_entity_type in ('customer_account', 'support_ticket') then 'customers'
    when p_entity_type in ('products', 'categories', 'promotions', 'delivery_zones', 'printing_price_rules', 'homepage_banners',
                           'product_review', 'product_images') then 'catalog'
    when p_entity_type in ('profiles', 'role_permissions', 'website_settings', 'bank_accounts', 'notification') then 'staff'
    else 'other'
  end
$$;

-- ============================================================ Orders: 30-minute payment window, first to pay gets it
update public.website_settings
   set value = value || jsonb_build_object('payment_window_minutes', 30)
 where key = 'delivery' and not (value ? 'payment_window_minutes');

create or replace function private.order_payment_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes integer;
begin
  if new.status <> 'awaiting_payment' then return new; end if;
  v_minutes := coalesce((private.setting('delivery') ->> 'payment_window_minutes')::integer, 30);
  new.payment_due_at := now() + make_interval(mins => greatest(5, least(v_minutes, 10080)));
  return new;
end;
$$;
drop trigger if exists orders_payment_window on public.orders;
create trigger orders_payment_window before insert on public.orders
  for each row execute function private.order_payment_window();

-- Release overdue unpaid orders before taking a new one, so their stock is free for this buyer.
create or replace function public.create_order_for_user(p_user_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders;
  v_result jsonb;
begin
  perform private.assert_confirmed_user(p_user_id);
  -- An idempotent replay must come from the same account.
  select * into v_existing from public.orders where idempotency_key = (p_input ->> 'idempotency_key')::uuid;
  if found and v_existing.user_id is distinct from p_user_id then
    perform private.app_error('idempotency_conflict');
  end if;
  -- Retry of a checkout that was already paid with the balance: same order, fresh access tokens, no second charge.
  if found and v_existing.payment_method = 'wallet' then
    update public.orders
       set access_token_hash = p_input ->> 'access_token_hash', tracking_code_hash = p_input ->> 'tracking_code_hash'
     where id = v_existing.id;
    return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
                              'total_etb', v_existing.total_etb, 'replayed', true, 'paid_with_wallet', true);
  end if;
  -- Unpaid orders past their 30 minutes give their items back first: the first to pay gets the item.
  perform public.expire_unpaid_orders();
  perform private.set_status_note(null);
  perform set_config('app.ordering_user_id', p_user_id::text, true);
  v_result := public.create_order(p_input);
  -- Clear immediately so nothing later in the same transaction inherits this user.
  perform set_config('app.ordering_user_id', '', true);
  delete from public.customer_carts where user_id = p_user_id;
  -- Pay with the account balance: all or nothing (an insufficient balance cancels the whole checkout).
  if p_input ->> 'payment_method' = 'wallet' then
    perform private.pay_order_from_wallet((v_result ->> 'order_id')::uuid, p_user_id);
    v_result := v_result || jsonb_build_object('paid_with_wallet', true);
  end if;
  return v_result;
end;
$$;

-- ============================================================ Exports are recorded (and gate clearing)
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
  elsif p_kind = 'users' then perform private.require_permission('security.manage');
  elsif p_kind = 'support' then perform private.require_permission('support.view');
  elsif p_kind = 'customers' then perform private.require_permission('customers.view');
  elsif p_kind = 'products' then perform private.require_permission('products.view');
  elsif p_kind = 'wallet' then perform private.require_permission('wallet.manage');
  elsif p_kind = 'printing' then perform private.require_permission('printing.view');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;
