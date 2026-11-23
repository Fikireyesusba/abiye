-- =============================================================================
-- 0068 COURIERS (and the role used by the separate sign-in addresses)
--   * New permission set "Courier" with one permission: deliveries.own — only the deliveries assigned
--     to them, through the functions below (couriers cannot read the orders table).
--   * Admin assigns a delivery order to a courier (orders.manage). A 4-digit delivery code is made for
--     the customer (shown on their order page); the courier enters it at the door.
--   * Courier steps: Picked up (→ out for delivery), Delivered (with the customer's code → completed),
--     Couldn't deliver (with a reason → back to preparing, admin decides). 5 wrong codes lock the code.
--   * The customer's name, phone and address are shown to the courier only while the delivery is
--     assigned to them and not finished.
--   * Every step: Activity log + orders & payments Telegram group (User ID of the courier).
--   * my_staff_status also returns the permission set (each one signs in at its own address).
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('deliveries.own', 'Courier app: deliver the orders assigned to me')
on conflict (key) do nothing;

insert into public.admin_roles (key, name, description, is_builtin)
values ('courier', 'Courier', 'Delivers the orders assigned to them (courier app only).', true)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'deliveries.own' from public.admin_roles r where r.key = 'courier'
on conflict do nothing;
-- The Super Admin has every permission.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'deliveries.own' from public.admin_roles r where r.key = 'super_admin'
on conflict do nothing;

alter table public.orders
  add column courier_id            uuid references public.profiles(id) on delete set null,
  add column courier_assigned_at   timestamptz,
  add column picked_up_at          timestamptz,
  add column delivered_at          timestamptz,
  add column delivery_code         text check (delivery_code ~ '^[0-9]{4}$'),
  add column delivery_code_tries   integer not null default 0 check (delivery_code_tries >= 0),
  add column delivery_failed_at    timestamptz,
  add column delivery_fail_reason  text check (char_length(delivery_fail_reason) <= 300),
  add column delivery_attempts     integer not null default 0 check (delivery_attempts >= 0);
create index orders_courier_idx on public.orders (courier_id) where courier_id is not null;

create or replace function public.my_staff_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'staff', exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active),
    'mfa_verified', private.mfa_verified(),
    'role', (select r.key from public.profiles p join public.admin_roles r on r.id = p.role_id
              where p.id = (select auth.uid()) and p.is_active))
$$;

create or replace function private.delivery_event(p_order public.orders, p_step text, p_extra jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.enqueue_notification('delivery_update', 'delivery:' || p_order.id || ':' || p_step || ':' || clock_timestamp(),
    jsonb_build_object('order_id', p_order.id, 'order_number', p_order.order_number, 'step', p_step,
      'courier_user_id', private.member_of(p_order.courier_id), 'by_user_id', private.member_of((select auth.uid())),
      'city', p_order.city, 'at', now()) || coalesce(p_extra, '{}'::jsonb))
$$;

-- Admin: give a delivery order to a courier (or take it back with null).
create or replace function public.admin_assign_courier(p_order_id uuid, p_courier uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
begin
  perform private.require_permission('orders.manage');
  select * into v from public.orders where id = p_order_id for update;
  if not found then perform private.app_error('not_found'); end if;
  if v.fulfillment_method <> 'delivery' then perform private.app_error('invalid_request', 'pickup order'); end if;
  if v.status not in ('confirmed', 'processing', 'out_for_delivery') then perform private.app_error('invalid_transition'); end if;
  if p_courier is not null and not exists (
       select 1 from public.profiles p join public.admin_roles r on r.id = p.role_id
        where p.id = p_courier and p.is_active and r.key = 'courier') then
    perform private.app_error('invalid_assignee');
  end if;
  if p_courier is null and v.status = 'out_for_delivery' then perform private.app_error('invalid_transition', 'on the way'); end if;
  update public.orders
     set courier_id = p_courier,
         courier_assigned_at = case when p_courier is null then null else now() end,
         delivery_code = case when p_courier is null then delivery_code else coalesce(delivery_code, lpad((floor(random() * 10000))::int::text, 4, '0')) end,
         delivery_code_tries = 0
   where id = v.id
  returning * into v;
  perform private.audit(case when p_courier is null then 'courier_unassigned' else 'courier_assigned' end, 'order', v.id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('order_number', v.order_number, 'courier_user_id', private.member_of(p_courier))));
  if p_courier is not null then perform private.delivery_event(v, 'assigned'); end if;
end;
$$;

-- Couriers' active deliveries (contact details only while assigned and not finished) + today's finished ones.
create or replace function public.courier_deliveries()
returns table (order_id uuid, order_number text, status text, customer_name text, customer_phone text, city text,
               address_line text, delivery_instructions text, items jsonb, total_etb numeric, assigned_at timestamptz,
               picked_up_at timestamptz, delivered_at timestamptz, fail_reason text, active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  return query
    select o.id, o.order_number::text, o.status::text,
           case when a then o.customer_name end, case when a then o.customer_phone end, o.city,
           case when a then o.address_line end, case when a then o.delivery_instructions end,
           (select coalesce(jsonb_agg(jsonb_build_object('name', i.name_en, 'quantity', i.quantity) order by i.created_at), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id),
           o.total_etb, o.courier_assigned_at, o.picked_up_at, o.delivered_at, o.delivery_fail_reason, a
      from public.orders o
      cross join lateral (select o.status in ('confirmed', 'processing', 'out_for_delivery') as a) x
     where o.courier_id = (select auth.uid())
       and (a or (o.status = 'completed' and o.delivered_at > now() - interval '24 hours'))
     order by a desc, o.courier_assigned_at;
end;
$$;

create or replace function private.courier_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
begin
  perform private.require_permission('deliveries.own');
  select * into v from public.orders where id = p_order_id for update;
  if not found or v.courier_id is distinct from (select auth.uid()) then perform private.app_error('not_found'); end if;
  return v;
end;
$$;

create or replace function public.courier_pick_up(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
begin
  if v.status not in ('confirmed', 'processing') then perform private.app_error('invalid_transition'); end if;
  perform private.set_status_note('Picked up by the courier');
  update public.orders set status = 'out_for_delivery', picked_up_at = now(), delivery_failed_at = null, delivery_fail_reason = null
   where id = v.id returning * into v;
  perform private.audit('delivery_picked_up', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
  perform private.delivery_event(v, 'picked_up');
end;
$$;

-- true = delivered; false = wrong code (the try is counted; 5 wrong tries lock the code).
create or replace function public.courier_deliver(p_order_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
begin
  if v.status <> 'out_for_delivery' then perform private.app_error('invalid_transition'); end if;
  if v.delivery_code_tries >= 5 then perform private.app_error('delivery_locked'); end if;
  if v.delivery_code is null or coalesce(btrim(p_code), '') <> v.delivery_code then
    update public.orders set delivery_code_tries = delivery_code_tries + 1 where id = v.id returning * into v;
    if v.delivery_code_tries >= 5 then
      perform private.audit('delivery_code_locked', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
      perform private.delivery_event(v, 'code_locked');
    end if;
    -- The failed try is kept: a raised error would roll it back, so answer with a result instead.
    return false;
  end if;
  perform private.set_status_note('Delivered — customer''s code checked by the courier');
  update public.orders set status = 'completed', delivered_at = now() where id = v.id returning * into v;
  perform private.audit('delivery_completed', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
  perform private.delivery_event(v, 'delivered');
  return true;
end;
$$;

create or replace function public.courier_fail(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) not between 3 and 300 then perform private.app_error('invalid_reason'); end if;
  if v.status <> 'out_for_delivery' then perform private.app_error('invalid_transition'); end if;
  perform private.set_status_note('Courier could not deliver: ' || v_reason);
  update public.orders
     set status = 'processing', delivery_failed_at = now(), delivery_fail_reason = v_reason, delivery_attempts = delivery_attempts + 1
   where id = v.id returning * into v;
  perform private.audit('delivery_failed', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number, 'reason', v_reason));
  perform private.delivery_event(v, 'failed', jsonb_build_object('reason', v_reason));
end;
$$;

revoke all on function public.admin_assign_courier(uuid, uuid) from public, anon;
revoke all on function public.courier_deliveries() from public, anon;
revoke all on function public.courier_pick_up(uuid) from public, anon;
revoke all on function public.courier_deliver(uuid, text) from public, anon;
revoke all on function public.courier_fail(uuid, text) from public, anon;
revoke all on function private.courier_order(uuid) from public;
revoke all on function private.delivery_event(public.orders, text, jsonb) from public;
grant execute on function public.admin_assign_courier(uuid, uuid) to authenticated;
grant execute on function public.courier_deliveries() to authenticated;
grant execute on function public.courier_pick_up(uuid) to authenticated;
grant execute on function public.courier_deliver(uuid, text) to authenticated;
grant execute on function public.courier_fail(uuid, text) to authenticated;
