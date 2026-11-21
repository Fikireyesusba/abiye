-- =============================================================================
-- 0045 PAID ORDERS ONLY, PAYMENT-ONLY ALERTS, LOCKED PERSONAL DETAILS
--   * Orders group on Telegram: only payments — receipts / top-ups waiting for
--     approval and completed payments (verified, paid with balance) — plus
--     printing requests that need a price (switch). No order steps,
--     cancellations, rejections or copies of customer messages.
--   * Dashboard counts an order only once it is paid (receipt pending approval,
--     verified or refunded). Unpaid checkouts live under "Stalled checkouts".
--   * Customers set their name and phone once; after that only staff can
--     change them (and the sign-in email). Delivery city / address stay theirs.
-- =============================================================================

create or replace function private.telegram_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel <> 'telegram' then return new; end if;
  if new.event_type in ('order_placed', 'order_status', 'printing_status', 'order_cancelled', 'payment_rejected', 'notification_copy') then
    return null;
  end if;
  if new.event_type = 'printing_request' and not private.feed_on('printing_requests') then return null; end if;
  return new;
end;
$$;

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
  v_today     date := (now() at time zone 'Africa/Addis_Ababa')::date;
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
    'orders_today', (select count(*) from visible where (created_at at time zone 'Africa/Addis_Ababa')::date = v_today),
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
              and (payment_verified_at at time zone 'Africa/Addis_Ababa')::date > v_today - v_days) end,
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'day', d.day,
               'orders', (select count(*) from visible v where (v.created_at at time zone 'Africa/Addis_Ababa')::date = d.day),
               'revenue', case when v_revenue then (
                   select coalesce(sum(o.total_etb), 0) from public.orders o
                    where o.payment_status = 'verified'
                      and (o.payment_verified_at at time zone 'Africa/Addis_Ababa')::date = d.day) end)
             order by d.day)
      from (select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as day) d
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_dashboard_stats(integer) from public, anon;
grant execute on function public.admin_dashboard_stats(integer) to authenticated;

-- Name and phone: the customer fills them in once; later changes only through staff.
create or replace function private.customer_details_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Staff tools are security definer functions (they do not run as "authenticated").
  if current_user <> 'authenticated' then return new; end if;
  if nullif(btrim(coalesce(old.full_name, '')), '') is not null then new.full_name := old.full_name; end if;
  if old.phone is not null then new.phone := old.phone; end if;
  return new;
end;
$$;
drop trigger if exists customer_details_lock on public.customer_accounts;
create trigger customer_details_lock before update on public.customer_accounts
  for each row execute function private.customer_details_lock();

-- The sign-in email cannot be changed by the customer (an email-change request is refused);
-- staff change it directly through the Auth admin API, which does not use email_change.
create or replace function private.refuse_self_email_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change then
    raise exception 'email_change_not_allowed' using errcode = 'P0001',
      hint = 'Customers cannot change their email; staff can (Admin → Customers).';
  end if;
  return new;
end;
$$;
drop trigger if exists refuse_self_email_change on auth.users;
create trigger refuse_self_email_change before update on auth.users
  for each row execute function private.refuse_self_email_change();

-- Staff: change a customer's name / phone (recorded in the activity log). The email itself is changed
-- by the server with the Auth admin API first; p_old_email is then recorded here with the new one.
create or replace function public.admin_update_customer_details(p_user_id uuid, p_full_name text, p_phone text, p_old_email text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.customer_accounts;
begin
  perform private.require_permission('customers.manage');
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then perform private.app_error('not_found'); end if;
  if exists (select 1 from public.profiles where id = p_user_id) then perform private.app_error('invalid_request', 'staff account'); end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 2 and 120 then perform private.app_error('invalid_name'); end if;
  if p_phone is not null and p_phone !~ '^\+251[79][0-9]{8}$' then perform private.app_error('invalid_phone'); end if;
  insert into public.customer_accounts (id) values (p_user_id) on conflict do nothing;
  select * into v_before from public.customer_accounts where id = p_user_id for update;
  update public.customer_accounts set full_name = btrim(p_full_name), phone = p_phone where id = p_user_id;
  perform private.audit('profile_updated', 'customer_account', p_user_id::text,
    jsonb_strip_nulls(jsonb_build_object('full_name', v_before.full_name, 'phone', v_before.phone, 'email', p_old_email)),
    jsonb_strip_nulls(jsonb_build_object('full_name', btrim(p_full_name), 'phone', p_phone,
      'email', case when p_old_email is not null then (select u.email::text from auth.users u where u.id = p_user_id) end)),
    jsonb_build_object('by', 'staff'));
end;
$$;
revoke all on function public.admin_update_customer_details(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_customer_details(uuid, text, text, text) to authenticated;
