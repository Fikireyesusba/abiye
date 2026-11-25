-- =============================================================================
-- 0075 COURIER FLOW LINKED END TO END
--   * As soon as a delivery / partner-shop order is paid (payment verified or paid with balance), a courier is
--     assigned automatically: on duty for the order's city (the shop's city), least busy first, never one who
--     declined it. No courier available → the order is OPEN: couriers on duty for that city see it under
--     "Open deliveries" in their app and can take it (first one wins). Switch: Couriers & delivery (Super Admin).
--   * A courier who declines → the order goes to the next available courier, or becomes open for the others.
--   * The office can cancel an order also while it is with the courier or at the partner shop: the courier and
--     the shop see "Cancelled by the office" (with the reason) and must not hand it over.
--   * Statuses follow the apps: a courier-run order moves to "on the way", "at the shop" and "completed" only
--     through the courier / Business apps (PINs) — no manual skip in the admin. The office can still re-assign,
--     take it back (on the way → processing) or cancel.
-- =============================================================================

alter table public.courier_notifications drop constraint if exists courier_notifications_kind_check;
alter table public.courier_notifications add constraint courier_notifications_kind_check
  check (kind in ('assigned', 'unassigned', 'payout', 'message', 'available', 'cancelled'));

insert into public.website_settings (key, value, is_public) values ('courier', '{"auto_assign": true}', false)
on conflict (key) do update set value = case when public.website_settings.value ? 'auto_assign' then public.website_settings.value
                                             else public.website_settings.value || '{"auto_assign": true}' end;

-- ------------------------------------------------------------ assignment core (shared by admin, auto and "take it")
create or replace function private.assign_courier(p_order_id uuid, p_courier uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
  v_old uuid;
  v_code text := lpad((floor(random() * 10000))::int::text, 4, '0');
begin
  select * into v from public.orders where id = p_order_id for update;
  if not found then perform private.app_error('not_found'); end if;
  if v.fulfillment_method <> 'delivery' and v.partner_shop_id is null then perform private.app_error('invalid_request', 'pickup order'); end if;
  if v.status not in ('confirmed', 'processing', 'out_for_delivery') then perform private.app_error('invalid_transition'); end if;
  if p_courier is not null and not exists (
       select 1 from public.profiles p join public.admin_roles r on r.id = p.role_id
        where p.id = p_courier and p.is_active and r.key = 'courier') then
    perform private.app_error('invalid_assignee');
  end if;
  if p_courier is null and v.status = 'out_for_delivery' then perform private.app_error('invalid_transition', 'on the way'); end if;
  v_old := v.courier_id;
  update public.orders
     set courier_id = p_courier,
         courier_assigned_at = case when p_courier is null then null else now() end,
         delivery_code = case when p_courier is null then delivery_code else coalesce(delivery_code, lpad((floor(random() * 10000))::int::text, 4, '0')) end,
         delivery_code_tries = 0,
         handoff_courier_code = case when partner_shop_id is null or p_courier is null then handoff_courier_code
                                     when v_old is distinct from p_courier or handoff_courier_code is null then v_code else handoff_courier_code end,
         handoff_shop_code = case when partner_shop_id is null or p_courier is null then handoff_shop_code
                                  when v_old is distinct from p_courier or handoff_shop_code is null
                                    then lpad(((v_code::int + 1 + floor(random() * 9998))::int % 10000)::text, 4, '0') else handoff_shop_code end,
         handoff_courier_at = case when v_old is distinct from p_courier then null else handoff_courier_at end,
         handoff_shop_at = case when v_old is distinct from p_courier then null else handoff_shop_at end,
         handoff_tries = 0
   where id = v.id
  returning * into v;
  perform private.audit(case when p_courier is null then 'courier_unassigned' else 'courier_assigned' end, 'order', v.id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('order_number', v.order_number, 'courier_user_id', private.member_of(p_courier))));
  if v_old is not null and v_old is distinct from p_courier then
    perform private.notify_courier(v_old, 'unassigned', 'Delivery ' || v.order_number || ' was taken back', 'The office gave it to someone else or will deliver it another way.', v.id);
  end if;
  if p_courier is not null and v_old is distinct from p_courier then
    perform private.notify_courier(p_courier, 'assigned', 'New delivery: ' || v.order_number,
      case when v.partner_shop_id is not null then 'To partner shop ' || coalesce(v.partner_snapshot ->> 'name', '') || ' — ' || coalesce(v.city, '')
           else coalesce(v.city, '') || coalesce(' — ' || v.address_line, '') end, v.id);
  end if;
  if p_courier is not null then perform private.delivery_event(v, 'assigned'); end if;
  return v;
end;
$$;
revoke all on function private.assign_courier(uuid, uuid) from public;

create or replace function public.admin_assign_courier(p_order_id uuid, p_courier uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('orders.manage');
  perform private.assign_courier(p_order_id, p_courier);
end;
$$;

-- Couriers who may take this order: active, on duty for its city, never declined it. Least busy first.
create or replace function private.couriers_for_order(p_order public.orders)
returns table (courier_id uuid, active bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, (select count(*) from public.orders o where o.courier_id = p.id and o.status in ('confirmed', 'processing', 'out_for_delivery')) as active
    from public.profiles p
    join public.admin_roles r on r.id = p.role_id and r.key = 'courier'
    join public.courier_profiles cp on cp.profile_id = p.id and cp.on_duty
   where p.is_active and p.removed_at is null
     and p_order.delivery_zone_id = any(coalesce(cp.available_zone_ids, '{}'))
     and not exists (select 1 from public.audit_logs a where a.action = 'delivery_declined' and a.entity_id = p_order.id::text and a.actor_id = p.id)
   order by 2, cp.on_duty_since nulls last
$$;
revoke all on function private.couriers_for_order(public.orders) from public;

-- Give a paid order to the best courier, or open it for the couriers of its city. Returns the courier (or null).
create or replace function private.auto_assign_courier(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
  v_courier uuid;
  r record;
begin
  select * into v from public.orders where id = p_order_id;
  if not found or v.courier_id is not null or v.payment_status <> 'verified' or v.status not in ('confirmed', 'processing')
     or (v.fulfillment_method <> 'delivery' and v.partner_shop_id is null) then
    return null;
  end if;
  select c.courier_id into v_courier from private.couriers_for_order(v) c limit 1;
  if v_courier is not null then
    perform private.assign_courier(v.id, v_courier);
    return v_courier;
  end if;
  -- Nobody free: open for every courier who goes on duty for that city (they see it in the app).
  for r in select c.courier_id from private.couriers_for_order(v) c loop
    perform private.notify_courier(r.courier_id, 'available', 'Open delivery: ' || v.order_number, coalesce(v.city, '') || ' — tap Take it in Deliveries.', v.id);
  end loop;
  perform private.delivery_event(v, 'open', jsonb_build_object('shop', v.partner_snapshot ->> 'name'));
  return null;
end;
$$;
revoke all on function private.auto_assign_courier(uuid) from public;

create or replace function private.auto_assign_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status = 'verified' and old.payment_status is distinct from 'verified' and new.courier_id is null
     and (new.fulfillment_method = 'delivery' or new.partner_shop_id is not null)
     and coalesce((private.setting('courier') ->> 'auto_assign')::boolean, true) then
    perform private.auto_assign_courier(new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.auto_assign_on_payment() from public;
create trigger orders_auto_assign after update of payment_status on public.orders
  for each row execute function private.auto_assign_on_payment();

create or replace function public.admin_set_auto_assign(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('couriers.manage');
  update public.website_settings set value = value || jsonb_build_object('auto_assign', coalesce(p_on, true)) where key = 'courier';
  perform private.audit('courier_auto_assign_set', 'website_settings', 'courier', null, null, jsonb_build_object('auto_assign', coalesce(p_on, true)));
end;
$$;

-- Office: assign automatically now (e.g. after re-opening an order).
create or replace function public.admin_auto_assign_courier(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('orders.manage');
  return private.auto_assign_courier(p_order_id);
end;
$$;

-- ------------------------------------------------------------ courier app: open deliveries + take it
create or replace function public.courier_available()
returns table (order_id uuid, order_number text, city text, partner_shop text, pay_etb numeric, paid_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform private.require_permission('deliveries.own');
  return query
    select o.id, o.order_number::text, o.city, o.partner_snapshot ->> 'name',
           coalesce(o.delivery_fee_full_etb, o.delivery_fee_etb), o.payment_verified_at
      from public.orders o
      join public.courier_profiles cp on cp.profile_id = v_uid and cp.on_duty
     where o.courier_id is null and o.payment_status = 'verified' and o.status in ('confirmed', 'processing')
       and (o.fulfillment_method = 'delivery' or o.partner_shop_id is not null)
       and o.delivery_zone_id = any(coalesce(cp.available_zone_ids, '{}'))
       and not exists (select 1 from public.audit_logs a where a.action = 'delivery_declined' and a.entity_id = o.id::text and a.actor_id = v_uid)
     order by o.payment_verified_at
     limit 50;
end;
$$;

create or replace function public.courier_take(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
begin
  perform private.require_permission('deliveries.own');
  select * into v from public.orders where id = p_order_id for update;
  if not found or v.courier_id is not null
     or not exists (select 1 from public.courier_available() a where a.order_id = p_order_id) then
    perform private.app_error('invalid_transition', 'taken');
  end if;
  perform private.assign_courier(v.id, (select auth.uid()));
  perform private.audit('delivery_taken', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
end;
$$;

-- Decline: off duty, and the order goes to the next courier (or opens for the others).
create or replace function public.courier_decline(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_courier uuid := v.courier_id;
begin
  if char_length(v_reason) not between 3 and 300 then perform private.app_error('invalid_reason'); end if;
  if v.status not in ('confirmed', 'processing') then perform private.app_error('invalid_transition'); end if;
  update public.orders set courier_id = null, courier_assigned_at = null, delivery_code_tries = 0,
         handoff_courier_at = null, handoff_shop_at = null where id = v.id;
  update public.courier_profiles set on_duty = false, on_duty_since = null where profile_id = v_courier;
  perform private.audit('delivery_declined', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number, 'reason', v_reason));
  perform private.delivery_event(v, 'declined', jsonb_build_object('reason', v_reason));
  if coalesce((private.setting('courier') ->> 'auto_assign')::boolean, true) then
    perform private.auto_assign_courier(v.id);
  end if;
end;
$$;

-- Courier list: also orders the office cancelled in the last 24 hours (return them).
drop function if exists public.courier_deliveries();
create function public.courier_deliveries()
returns table (order_id uuid, order_number text, status text, customer_name text, customer_phone text, city text,
               address_line text, delivery_instructions text, assigned_at timestamptz,
               picked_up_at timestamptz, delivered_at timestamptz, fail_reason text, active boolean,
               partner_shop text, partner_phone text, partner_landmark text, partner_map_url text, partner_hours text,
               handoff_code text, handoff_courier_done boolean, handoff_shop_done boolean, cancel_note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  return query
    select o.id, o.order_number::text, o.status::text,
           case when a or o.status = 'cancelled' then o.customer_name end,
           case when a and o.partner_shop_id is null then o.customer_phone end, o.city,
           case when a then case when o.partner_shop_id is null then o.address_line else o.partner_snapshot ->> 'address_line' end end,
           case when a and o.partner_shop_id is null then o.delivery_instructions end,
           o.courier_assigned_at, o.picked_up_at, coalesce(o.at_shop_at, o.delivered_at, o.cancelled_at), o.delivery_fail_reason, a,
           o.partner_snapshot ->> 'name', case when a then o.partner_snapshot ->> 'phone' end, case when a then o.partner_snapshot ->> 'landmark' end,
           case when a then o.partner_snapshot ->> 'map_url' end, case when a then o.partner_snapshot ->> 'opening_hours' end,
           case when a and o.status = 'out_for_delivery' then o.handoff_courier_code end,
           o.handoff_courier_at is not null, o.handoff_shop_at is not null,
           case when o.status = 'cancelled' then (select h.note from public.order_status_history h where h.order_id = o.id and h.to_status = 'cancelled' order by h.created_at desc limit 1) end
      from public.orders o
      cross join lateral (select o.status in ('confirmed', 'processing', 'out_for_delivery') as a) x
     where o.courier_id = (select auth.uid())
       and (a or coalesce(o.at_shop_at, o.delivered_at, o.cancelled_at) > now() - interval '24 hours')
     order by a desc, o.courier_assigned_at;
end;
$$;
revoke all on function public.courier_deliveries() from public, anon;
grant execute on function public.courier_deliveries() to authenticated;

-- Business app: cancelled orders of the shop (last 7 days) with the office's reason.
drop function if exists public.partner_orders();
create function public.partner_orders()
returns table (order_id uuid, order_number text, status text, stage text, customer_name text, customer_phone text,
               courier_name text, courier_phone text, shop_code text, shop_confirmed boolean, courier_confirmed boolean, handoff_locked boolean,
               pin_locked boolean, paid_at timestamptz, at_shop_at timestamptz, collected_at timestamptz, cancel_note text, cancelled_at timestamptz)
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
           o.delivery_code_tries >= 5, o.payment_verified_at, o.at_shop_at, case when st = 'collected' then o.delivered_at end,
           case when st = 'cancelled' then (select h.note from public.order_status_history h where h.order_id = o.id and h.to_status = 'cancelled' order by h.created_at desc limit 1) end,
           o.cancelled_at
      from public.orders o
      cross join lateral (select case when o.status = 'out_for_delivery' then 'incoming' when o.status = 'ready_for_pickup' then 'at_shop'
                                      when o.status = 'completed' then 'collected' when o.status = 'cancelled' then 'cancelled' else 'expected' end as st) x
      left join public.profiles cpr on cpr.id = o.courier_id
      left join public.courier_profiles cp on cp.profile_id = o.courier_id
     where o.partner_shop_id = v_shop and o.payment_status in ('verified', 'refunded')
       and (o.status in ('confirmed', 'processing', 'out_for_delivery', 'ready_for_pickup')
            or (o.status = 'completed' and o.delivered_at > now() - interval '7 days')
            or (o.status = 'cancelled' and o.cancelled_at > now() - interval '7 days'))
     order by case st when 'cancelled' then 0 when 'incoming' then 1 when 'at_shop' then 2 when 'expected' then 3 else 4 end, o.payment_verified_at;
end;
$$;
revoke all on function public.partner_orders() from public, anon;
grant execute on function public.partner_orders() to authenticated;

-- ------------------------------------------------------------ office status changes, linked to the apps
create or replace function public.admin_update_order_status(p_order_id uuid, p_status public.order_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_ok    boolean;
  -- Run by the courier / Business apps (PINs): a courier is on it, or it goes to a partner shop.
  v_app   boolean;
begin
  if not private.can_view_order(p_order_id) then perform private.app_error('not_found'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then perform private.app_error('not_found'); end if;
  v_app := v_order.courier_id is not null or v_order.partner_shop_id is not null;

  v_ok := case
    when p_status = 'cancelled' then v_order.status in
      ('awaiting_payment', 'payment_rejected', 'pending_verification', 'confirmed', 'processing', 'out_for_delivery', 'ready_for_pickup')
    when v_order.status = 'confirmed' then p_status = 'processing'
    when v_order.status = 'processing' then not v_app and (
      (p_status = 'ready_for_pickup' and v_order.fulfillment_method = 'pickup')
      or (p_status = 'out_for_delivery' and v_order.fulfillment_method = 'delivery'))
    when v_order.status = 'ready_for_pickup' then p_status = 'completed' and not v_app
    when v_order.status = 'out_for_delivery' then p_status = 'processing' or (p_status = 'completed' and not v_app)
    else false
  end;
  if not v_ok then
    perform private.app_error('invalid_transition', v_order.status::text || '->' || p_status::text || case when v_app then ' (courier app)' else '' end);
  end if;

  if p_status = 'cancelled' then
    perform private.require_permission('orders.manage');
    if v_note is null then perform private.app_error('note_required'); end if;
    perform private.release_order_stock(v_order.id);
    update public.printing_jobs set status = 'cancelled'
     where order_id = v_order.id and status not in ('completed', 'cancelled');
    perform private.enqueue_notification('order_cancelled', 'order_cancelled:' || v_order.id,
      jsonb_build_object('order_number', v_order.order_number, 'note', v_note,
                         'refund_required', v_order.payment_status = 'verified'));
    if v_order.courier_id is not null then
      perform private.notify_courier(v_order.courier_id, 'cancelled', 'Cancelled: ' || v_order.order_number,
        'Cancelled by the office: ' || left(v_note, 200) || case when v_order.status in ('out_for_delivery', 'ready_for_pickup') then ' — bring the parcel back to the office.' else '' end, v_order.id);
    end if;
    if v_app then perform private.delivery_event(v_order, 'cancelled', jsonb_build_object('reason', v_note, 'shop', v_order.partner_snapshot ->> 'name', 'was', v_order.status)); end if;
  elsif not (private.has_permission('orders.manage') or private.has_permission('orders.update_fulfillment')) then
    perform private.app_error('forbidden', 'orders.update_fulfillment');
  end if;

  if v_order.status = 'out_for_delivery' and p_status = 'processing' and v_order.courier_id is not null then
    -- Taken back from the courier (not handed over): the hand-over starts again.
    update public.orders set handoff_courier_at = null, handoff_shop_at = null, handoff_tries = 0 where id = v_order.id;
    perform private.notify_courier(v_order.courier_id, 'message', 'Delivery ' || v_order.order_number || ' paused by the office',
      coalesce(v_note, 'The office will contact you.'), v_order.id);
  end if;

  perform private.set_status_note(v_note);
  update public.orders
     set status = p_status,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
   where id = v_order.id;

  perform private.audit('order_status', 'order', v_order.id::text,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', p_status, 'note', v_note));
end;
$$;

revoke all on function public.admin_set_auto_assign(boolean) from public, anon;
revoke all on function public.admin_auto_assign_courier(uuid) from public, anon;
revoke all on function public.courier_available() from public, anon;
revoke all on function public.courier_take(uuid) from public, anon;
grant execute on function public.admin_set_auto_assign(boolean) to authenticated;
grant execute on function public.admin_auto_assign_courier(uuid) to authenticated;
grant execute on function public.courier_available() to authenticated;
grant execute on function public.courier_take(uuid) to authenticated;
