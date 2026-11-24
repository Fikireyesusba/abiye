-- =============================================================================
-- 0074 COURIER & BUSINESS APPS: LESS ORDER DETAIL, MONITORING AND ALERTS
--   * Couriers and partner shops see only the order number and the customer's name (plus where to go /
--     who to call while it is theirs) — no products, quantities or prices.
--   * Every wrong PIN (customer PIN at the door / at the shop, hand-over PINs) is logged; on the Nth wrong
--     PIN of an order (Super Admin setting, default 3) a security alert goes to Telegram.
--   * Delivery monitor (Super Admin thresholds): paid orders waiting for a courier, assigned but not picked up,
--     on the way too long, waiting at a partner shop too long → one Telegram alert per order and problem
--     (orders & payments group). Checked at most every 5 minutes while staff / courier / shop apps are open,
--     and by the daily job.
--   * Admin → Delivery monitor: live counts, overdue list, couriers and shop staff with last activity,
--     event log of the courier and Business apps.
-- =============================================================================

insert into public.website_settings (key, value, is_public)
values ('delivery_monitor', '{"enabled": true, "dispatch_wait_hours": 2, "pickup_hours": 2, "delivery_hours": 6, "shop_collect_days": 3, "wrong_pin_alert": 3}', false)
on conflict (key) do nothing;

create or replace function private.monitor_setting(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(private.setting('delivery_monitor') ->> p_key, '')::numeric, p_default)
$$;
revoke all on function private.monitor_setting(text, numeric) from public;

-- Wrong-PIN alerts go to the security group.
create or replace function private.telegram_group(p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event in ('security_event', 'security_alert', 'admin_action', 'security_test', 'promotion_alert', 'account_pending', 'delivery_pin_alert') then 'security'
    when p_event in ('low_stock', 'out_of_stock', 'stock_test') then 'stock'
    when p_event in ('receipt_record', 'receipts_test', 'excel_export') then 'receipts'
    when p_event in ('printing_document', 'printing_test') then 'printing'
    when p_event in ('support_ticket', 'support_reply', 'support_rating', 'support_test') then 'support'
    else 'orders'
  end
$$;

-- ------------------------------------------------------------ wrong PINs: logged, alerted on the Nth
create or replace function private.log_wrong_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_tries integer;
  v_app text := case when private.has_permission('partner.own') and not private.has_permission('deliveries.own') then 'business' else 'courier' end;
  v_limit integer := private.monitor_setting('wrong_pin_alert', 3)::integer;
begin
  if new.delivery_code_tries > old.delivery_code_tries then
    v_kind := case when new.partner_shop_id is not null then 'customer_pin_at_shop' else 'customer_pin_at_door' end;
    v_tries := new.delivery_code_tries;
  elsif new.handoff_tries > old.handoff_tries then
    v_kind := 'handover_pin';
    v_tries := new.handoff_tries;
  else
    return new;
  end if;
  perform private.audit('pin_wrong', 'order', new.id::text, null, null,
    jsonb_build_object('order_number', new.order_number, 'pin', v_kind, 'try', v_tries, 'app', v_app,
                       'shop', new.partner_snapshot ->> 'name'));
  if v_tries = v_limit and v_limit < 5 and coalesce((private.setting('delivery_monitor') ->> 'enabled')::boolean, true) then
    perform private.enqueue_notification('delivery_pin_alert', 'pin:' || new.id || ':' || v_kind || ':' || v_tries || ':' || coalesce(new.courier_assigned_at::text, ''),
      jsonb_build_object('order_id', new.id, 'order_number', new.order_number, 'pin', v_kind, 'tries', v_tries, 'app', v_app,
        'by_user_id', private.member_of((select auth.uid())), 'courier_user_id', private.member_of(new.courier_id),
        'shop', new.partner_snapshot ->> 'name', 'city', new.city, 'at', now()));
  end if;
  return new;
end;
$$;
revoke all on function private.log_wrong_pin() from public;
create trigger orders_wrong_pin after update of delivery_code_tries, handoff_tries on public.orders
  for each row execute function private.log_wrong_pin();

-- ------------------------------------------------------------ overdue deliveries
-- What is late right now (shared by the alerts and the monitor page).
create or replace function private.delivery_overdue()
returns table (order_id uuid, order_number text, kind text, since timestamptz, hours numeric, courier_id uuid, city text, shop text)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select o.*, (o.partner_shop_id is not null) as at_partner from public.orders o
     where o.payment_status = 'verified' and (o.fulfillment_method = 'delivery' or o.partner_shop_id is not null)
       and o.status in ('confirmed', 'processing', 'out_for_delivery', 'ready_for_pickup')
  ), k as (
    select o.id, o.order_number::text, 'not_dispatched'::text as kind, o.payment_verified_at as since, o.courier_id, o.city, o.partner_snapshot ->> 'name' as shop,
           private.monitor_setting('dispatch_wait_hours', 2) as limit_h
      from o where o.status in ('confirmed', 'processing') and o.courier_id is null and o.payment_verified_at is not null
    union all
    select o.id, o.order_number::text, 'not_picked_up', o.courier_assigned_at, o.courier_id, o.city, o.partner_snapshot ->> 'name',
           private.monitor_setting('pickup_hours', 2)
      from o where o.status in ('confirmed', 'processing') and o.courier_id is not null and o.courier_assigned_at is not null
    union all
    select o.id, o.order_number::text, 'delivery_late', o.picked_up_at, o.courier_id, o.city, o.partner_snapshot ->> 'name',
           private.monitor_setting('delivery_hours', 6)
      from o where o.status = 'out_for_delivery' and o.picked_up_at is not null
    union all
    select o.id, o.order_number::text, 'not_collected', o.at_shop_at, o.courier_id, o.city, o.partner_snapshot ->> 'name',
           private.monitor_setting('shop_collect_days', 3) * 24
      from o where o.status = 'ready_for_pickup' and o.at_partner and o.at_shop_at is not null
  )
  select k.id, k.order_number, k.kind, k.since, round(extract(epoch from now() - k.since)::numeric / 3600, 1), k.courier_id, k.city, k.shop
    from k where k.since < now() - make_interval(secs => (k.limit_h * 3600)::double precision)
   order by k.since
$$;
revoke all on function private.delivery_overdue() from public;

create or replace function private.delivery_monitor_scan()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  if not coalesce((private.setting('delivery_monitor') ->> 'enabled')::boolean, true) then return 0; end if;
  for r in select * from private.delivery_overdue() loop
    -- One alert per order, problem and step (a re-assignment / new pickup starts a new step).
    perform private.enqueue_notification('delivery_alert', 'monitor:' || r.kind || ':' || r.order_id || ':' || r.since,
      jsonb_strip_nulls(jsonb_build_object('order_id', r.order_id, 'order_number', r.order_number, 'kind', r.kind, 'since', r.since,
        'hours', r.hours, 'courier_user_id', private.member_of(r.courier_id), 'city', r.city, 'shop', r.shop, 'at', now())));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.delivery_monitor_scan() from public;

-- Called while staff, courier or shop apps are open (and by the daily job): runs the scan at most every 5 minutes.
create or replace function public.delivery_monitor_tick()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  -- Only staff accounts and the server (service role: no signed-in user; anon cannot call this).
  if (select auth.uid()) is not null
     and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active) then
    return 0;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('delivery_monitor_tick')) then return 0; end if;
  v_last := nullif(private.setting('delivery_monitor') ->> 'last_scan_at', '')::timestamptz;
  if v_last is not null and v_last > now() - interval '5 minutes' then return 0; end if;
  update public.website_settings set value = value || jsonb_build_object('last_scan_at', now()) where key = 'delivery_monitor';
  return private.delivery_monitor_scan();
end;
$$;
revoke all on function public.delivery_monitor_tick() from public, anon;
grant execute on function public.delivery_monitor_tick() to authenticated, service_role;

-- Super Admin: thresholds.
create or replace function public.admin_set_delivery_monitor(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.require_permission('couriers.manage');
  v := jsonb_build_object(
    'enabled', coalesce((p ->> 'enabled')::boolean, true),
    'dispatch_wait_hours', (p ->> 'dispatch_wait_hours')::numeric, 'pickup_hours', (p ->> 'pickup_hours')::numeric,
    'delivery_hours', (p ->> 'delivery_hours')::numeric, 'shop_collect_days', (p ->> 'shop_collect_days')::numeric,
    'wrong_pin_alert', (p ->> 'wrong_pin_alert')::integer);
  if (v ->> 'dispatch_wait_hours')::numeric not between 0.25 and 168 or (v ->> 'pickup_hours')::numeric not between 0.25 and 168
     or (v ->> 'delivery_hours')::numeric not between 0.25 and 168 or (v ->> 'shop_collect_days')::numeric not between 1 and 60
     or (v ->> 'wrong_pin_alert')::integer not between 1 and 4 then
    perform private.app_error('invalid_request');
  end if;
  insert into public.website_settings (key, value, is_public) values ('delivery_monitor', v, false)
  on conflict (key) do update set value = public.website_settings.value || v;
  perform private.audit('delivery_monitor_set', 'website_settings', 'delivery_monitor', null, null, v);
end;
$$;
revoke all on function public.admin_set_delivery_monitor(jsonb) from public, anon;
grant execute on function public.admin_set_delivery_monitor(jsonb) to authenticated;

-- Monitor page: counts, late orders, couriers and shop staff with last activity, app events.
create or replace function public.admin_delivery_monitor(p_events integer default 150)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day timestamptz := date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
begin
  if not (private.has_permission('couriers.manage') or private.has_permission('orders.manage') or private.has_permission('partners.manage')) then
    perform private.app_error('forbidden');
  end if;
  return jsonb_build_object(
    'settings', coalesce(private.setting('delivery_monitor'), '{}'::jsonb),
    'counts', (select jsonb_build_object(
        'waiting_courier', count(*) filter (where o.status in ('confirmed', 'processing') and o.courier_id is null),
        'to_pick_up', count(*) filter (where o.status in ('confirmed', 'processing') and o.courier_id is not null),
        'on_the_way', count(*) filter (where o.status = 'out_for_delivery'),
        'at_shops', count(*) filter (where o.status = 'ready_for_pickup' and o.partner_shop_id is not null),
        'couriers_online', (select count(*) from public.courier_profiles cp join public.profiles p on p.id = cp.profile_id and p.is_active where cp.on_duty),
        'delivered_today', (select count(*) from public.orders d where d.status = 'completed' and d.delivered_at >= v_day and (d.fulfillment_method = 'delivery' or d.partner_shop_id is not null)),
        'wrong_pins_today', (select count(*) from public.audit_logs a where a.action = 'pin_wrong' and a.created_at >= v_day),
        'locked', (select count(*) from public.orders l where l.status in ('out_for_delivery', 'ready_for_pickup') and (l.delivery_code_tries >= 5 or l.handoff_tries >= 5)))
      from public.orders o
      where o.payment_status = 'verified' and (o.fulfillment_method = 'delivery' or o.partner_shop_id is not null)
        and o.status in ('confirmed', 'processing', 'out_for_delivery', 'ready_for_pickup')),
    'overdue', coalesce((select jsonb_agg(jsonb_build_object('order_id', d.order_id, 'order_number', d.order_number, 'kind', d.kind, 'since', d.since,
        'hours', d.hours, 'courier_user_id', private.member_of(d.courier_id), 'courier', (select full_name from public.profiles where id = d.courier_id),
        'city', d.city, 'shop', d.shop)) from private.delivery_overdue() d), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(x order by x ->> 'app', x ->> 'full_name') from (
        select jsonb_build_object('id', p.id, 'member_id', private.member_of(p.id), 'full_name', p.full_name, 'is_active', p.is_active,
          'app', case r.key when 'courier' then 'courier' else 'business' end,
          'shop', (select s.name from public.partner_staff ps join public.partner_shops s on s.id = ps.shop_id where ps.profile_id = p.id),
          'on_duty', coalesce((select cp.on_duty from public.courier_profiles cp where cp.profile_id = p.id), false),
          'last_sign_in_at', u.last_sign_in_at,
          'last_action_at', (select max(a.created_at) from public.audit_logs a where a.actor_id = p.id),
          'wrong_pins_today', (select count(*) from public.audit_logs a where a.actor_id = p.id and a.action = 'pin_wrong' and a.created_at >= v_day)) as x
          from public.profiles p join public.admin_roles r on r.id = p.role_id and r.key in ('courier', 'partner')
          join auth.users u on u.id = p.id
         where p.removed_at is null) t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(e order by (e ->> 'id')::bigint desc) from (
        select jsonb_build_object('id', a.id, 'at', a.created_at, 'action', a.action, 'user_id', private.member_of(a.actor_id),
          'name', (select full_name from public.profiles where id = a.actor_id), 'actor_role', a.actor_role,
          'order_number', a.metadata ->> 'order_number', 'detail', a.metadata - 'order_number') as e
          from public.audit_logs a
         where a.action in ('courier_assigned', 'courier_unassigned', 'delivery_picked_up', 'delivery_completed', 'delivery_failed', 'delivery_declined',
                            'delivery_code_locked', 'pin_wrong', 'handoff_courier_confirmed', 'handoff_shop_confirmed', 'handoff_locked',
                            'delivery_at_partner_shop', 'partner_order_collected', 'courier_on_duty', 'courier_off_duty', 'courier_details_updated')
         order by a.id desc limit least(greatest(coalesce(p_events, 150), 10), 500)) t), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_delivery_monitor(integer) from public, anon;
grant execute on function public.admin_delivery_monitor(integer) to authenticated;

-- ------------------------------------------------------------ couriers and shops: order number and customer name only
drop function if exists public.courier_deliveries();
create function public.courier_deliveries()
returns table (order_id uuid, order_number text, status text, customer_name text, customer_phone text, city text,
               address_line text, delivery_instructions text, assigned_at timestamptz,
               picked_up_at timestamptz, delivered_at timestamptz, fail_reason text, active boolean,
               partner_shop text, partner_phone text, partner_landmark text, partner_map_url text, partner_hours text,
               handoff_code text, handoff_courier_done boolean, handoff_shop_done boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  return query
    select o.id, o.order_number::text, o.status::text,
           case when a then o.customer_name end,
           case when a and o.partner_shop_id is null then o.customer_phone end, o.city,
           case when a then case when o.partner_shop_id is null then o.address_line else o.partner_snapshot ->> 'address_line' end end,
           case when a and o.partner_shop_id is null then o.delivery_instructions end,
           o.courier_assigned_at, o.picked_up_at, coalesce(o.at_shop_at, o.delivered_at), o.delivery_fail_reason, a,
           o.partner_snapshot ->> 'name', case when a then o.partner_snapshot ->> 'phone' end, case when a then o.partner_snapshot ->> 'landmark' end,
           case when a then o.partner_snapshot ->> 'map_url' end, case when a then o.partner_snapshot ->> 'opening_hours' end,
           case when a and o.status = 'out_for_delivery' then o.handoff_courier_code end,
           o.handoff_courier_at is not null, o.handoff_shop_at is not null
      from public.orders o
      cross join lateral (select o.status in ('confirmed', 'processing', 'out_for_delivery') as a) x
     where o.courier_id = (select auth.uid())
       and (a or (coalesce(o.at_shop_at, o.delivered_at) > now() - interval '24 hours'))
     order by a desc, o.courier_assigned_at;
end;
$$;
revoke all on function public.courier_deliveries() from public, anon;
grant execute on function public.courier_deliveries() to authenticated;

drop function if exists public.partner_orders();
create function public.partner_orders()
returns table (order_id uuid, order_number text, status text, stage text, customer_name text, customer_phone text,
               courier_name text, courier_phone text, shop_code text, shop_confirmed boolean, courier_confirmed boolean, handoff_locked boolean,
               pin_locked boolean, paid_at timestamptz, at_shop_at timestamptz, collected_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid := private.partner_shop_required();
begin
  return query
    select o.id, o.order_number::text, o.status::text, st,
           case when st <> 'collected' then o.customer_name end,
           case when st = 'at_shop' then o.customer_phone end,
           case when st in ('expected', 'incoming') then cpr.full_name end,
           case when st in ('expected', 'incoming') then cp.phone end,
           case when st = 'incoming' then o.handoff_shop_code end,
           o.handoff_shop_at is not null, o.handoff_courier_at is not null, o.handoff_tries >= 5,
           o.delivery_code_tries >= 5, o.payment_verified_at, o.at_shop_at, case when st = 'collected' then o.delivered_at end
      from public.orders o
      cross join lateral (select case when o.status = 'out_for_delivery' then 'incoming' when o.status = 'ready_for_pickup' then 'at_shop'
                                      when o.status = 'completed' then 'collected' else 'expected' end as st) x
      left join public.profiles cpr on cpr.id = o.courier_id
      left join public.courier_profiles cp on cp.profile_id = o.courier_id
     where o.partner_shop_id = v_shop and o.payment_status = 'verified'
       and (o.status in ('confirmed', 'processing', 'out_for_delivery', 'ready_for_pickup')
            or (o.status = 'completed' and o.delivered_at > now() - interval '7 days'))
     order by case st when 'incoming' then 0 when 'at_shop' then 1 when 'expected' then 2 else 3 end, o.payment_verified_at;
end;
$$;
revoke all on function public.partner_orders() from public, anon;
grant execute on function public.partner_orders() to authenticated;
