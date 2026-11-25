-- 0075: courier assigned when the payment is verified (least busy on duty for the city), open deliveries,
-- decline → next courier, office cancellation reaches the courier and the shop, statuses only through the apps.
\ir _helpers.sql
update public.profiles set role_id = (select id from public.admin_roles where key = 'courier') where id = :staff2;
-- a second courier (the "outsider" test account becomes a courier here)
insert into public.profiles (id, full_name, role_id) select :outsider, 'Courier Two', id from public.admin_roles where key = 'courier'
on conflict (id) do update set role_id = excluded.role_id, is_active = true;
update public.profiles set role_id = (select id from public.admin_roles where key = 'partner') where id = :staff;
update public.website_settings set value = value || '{"delivery_discounts": []}' where key = 'delivery';
\set zone '''40000000-0000-0000-0000-000000000001'''

-- No courier on duty: paid order becomes OPEN
set role service_role;
create temp table t_o as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'delivery')) as r;
reset role;
select r ->> 'order_id' as o1 from t_o \gset
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'o1'::uuid;
select pg_temp.ok((select courier_id is null from public.orders where id = :'o1'::uuid)
                  and (select count(*) from public.notifications_outbox where event_type = 'delivery_update' and payload ->> 'step' = 'open' and payload ->> 'order_id' = :'o1') = 1,
  'paid with no courier on duty: the order is open (office told)');

-- A courier goes on duty for the city: sees it under open deliveries and takes it
select pg_temp.login(:staff2);
select public.courier_set_duty(true, array[:zone::uuid]);
select pg_temp.ok((select count(*) from public.courier_available() where order_id = :'o1'::uuid) = 1, 'courier on duty for the city sees the open delivery');
select public.courier_take(:'o1'::uuid);
select pg_temp.ok((select count(*) from public.courier_deliveries() where order_id = :'o1'::uuid and active) = 1, 'taken: it is now the courier''s delivery');
reset role;
select pg_temp.login(:outsider);
select public.courier_set_duty(true, array[:zone::uuid]);
select pg_temp.throws(format($$select public.courier_take(%L)$$, :'o1'), 'invalid_transition', 'a taken delivery cannot be taken again');
reset role;

-- Next paid order: assigned automatically to the least busy courier (outsider has none)
set role service_role;
create temp table t_o2 as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'delivery')) as r;
reset role;
select r ->> 'order_id' as o2 from t_o2 \gset
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'o2'::uuid;
select pg_temp.ok((select courier_id = :outsider::uuid and delivery_code is not null from public.orders where id = :'o2'::uuid),
  'payment verified → courier assigned at once (least busy, on duty for the city)');

-- Decline → goes to the other courier (never back to the one who declined)
select pg_temp.login(:outsider);
select public.courier_decline(:'o2'::uuid, 'Bike broke down');
reset role;
select pg_temp.ok((select courier_id = :staff2::uuid from public.orders where id = :'o2'::uuid), 'declined: the next courier gets it');
select pg_temp.login(:staff2);
select public.courier_decline(:'o2'::uuid, 'Too far for me');
reset role;
select pg_temp.ok((select courier_id is null from public.orders where id = :'o2'::uuid), 'both declined: open again');
select pg_temp.login(:outsider);
select public.courier_set_duty(true, array[:zone::uuid]);
select pg_temp.ok((select count(*) from public.courier_available() where order_id = :'o2'::uuid) = 0, 'the courier who declined does not see it as open');
reset role;

-- Statuses only through the apps for courier orders
select pg_temp.login(:manager);
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'out_for_delivery')$$, :'o1'), 'invalid_transition', 'office cannot mark a courier order "on the way" (the courier does)');
reset role;
select pg_temp.login(:staff2);
select public.courier_pick_up(:'o1'::uuid);
reset role;
select pg_temp.login(:manager);
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'completed')$$, :'o1'), 'invalid_transition', 'office cannot complete a courier order (customer PIN in the app)');
-- office cancels while it is on the way → courier sees it cancelled
select public.admin_update_order_status(:'o1'::uuid, 'cancelled', 'Customer called to cancel');
reset role;
select pg_temp.login(:staff2);
select pg_temp.ok((select status = 'cancelled' and not active and cancel_note = 'Customer called to cancel' from public.courier_deliveries() where order_id = :'o1'::uuid)
                  and (select count(*) from public.courier_notifications where kind = 'cancelled' and order_id = :'o1'::uuid) = 1,
  'courier sees "cancelled by the office" with the reason (and a notification)');
select pg_temp.throws(format($$select public.courier_deliver(%L, '0000')$$, :'o1'), 'invalid_transition', 'a cancelled order cannot be delivered');
reset role;

-- Partner shop order cancelled at the shop → the shop sees it cancelled and cannot hand it over
select pg_temp.login(:super);
select public.admin_save_partner_shop(null, '{"name":"Cancel Test Shop","zone_id":"40000000-0000-0000-0000-000000000001","address_line":"Main road","phone":"+251911000999","handling_fee_etb":"20"}') as shop \gset
select public.admin_set_partner_staff(:staff, :'shop'::uuid);
reset role;
set role service_role;
create temp table t_o3 as select public.create_order_for_user(:customer,
  pg_temp.order_payload(gen_random_uuid(), jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')
  || jsonb_build_object('fulfillment', jsonb_build_object('method', 'pickup', 'partner_shop_id', :'shop'))) as r;
reset role;
select r ->> 'order_id' as o3 from t_o3 \gset
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'o3'::uuid;
select courier_id as c3 from public.orders where id = :'o3'::uuid \gset
select pg_temp.ok(:'c3' <> '', 'partner shop order: courier assigned when paid');
select handoff_courier_code as cc, handoff_shop_code as sc from public.orders where id = :'o3'::uuid \gset
select pg_temp.login(:'c3');
select public.courier_pick_up(:'o3'::uuid);
select public.courier_handoff(:'o3'::uuid, :'sc');
reset role;
select pg_temp.login(:staff);
select public.partner_receive(:'o3'::uuid, :'cc');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'completed')$$, :'o3'), 'invalid_transition', 'office cannot mark a partner shop order collected');
select public.admin_update_order_status(:'o3'::uuid, 'cancelled', 'Out of stock refund');
reset role;
select delivery_code as pin3 from public.orders where id = :'o3'::uuid \gset
select pg_temp.login(:staff);
select pg_temp.ok((select stage = 'cancelled' and cancel_note = 'Out of stock refund' from public.partner_orders() where order_id = :'o3'::uuid),
  'Business app: the order shows as cancelled with the reason');
select pg_temp.throws(format($$select public.partner_hand_over(%L, %L)$$, :'o3', :'pin3'), 'invalid_transition', 'the shop cannot hand over a cancelled order');
reset role;

-- auto-assign switch (Super Admin)
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_set_auto_assign(false)$$, 'forbidden', 'only the Super Admin switches auto-assign');
reset role;
rollback;
