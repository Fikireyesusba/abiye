-- 0073: partner shops — checkout pickup at a shop, courier ↔ shop hand-off with PINs both ways,
-- customer collects with their PIN, shop earnings / payouts, Business app access.
\ir _helpers.sql
update public.profiles set role_id = (select id from public.admin_roles where key = 'courier') where id = :staff2;
update public.profiles set role_id = (select id from public.admin_roles where key = 'partner') where id = :staff;
update public.website_settings set value = value || '{"delivery_discounts": []}' where key = 'delivery';

-- Super Admin: a shop in Addis Ababa (150 ETB city price in the test data), handling fee 50 ETB
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_save_partner_shop(null, '{"name":"Shop","zone_id":"40000000-0000-0000-0000-000000000001","address_line":"Piassa","phone":"0911"}')$$,
  'invalid_request', 'shop: phone must be +251…');
select public.admin_save_partner_shop(null, '{"name":"Hawassa Corner","zone_id":"40000000-0000-0000-0000-000000000001","address_line":"Piassa, next to the post office","landmark":"Blue gate","phone":"+251462201122","opening_hours":"Mon–Sat 8:00–19:00","map_url":"https://maps.google.com/?q=1","handling_fee_etb":"50"}') as shop \gset
select public.admin_set_partner_staff(:staff, :'shop'::uuid);
select pg_temp.throws(format($$select public.admin_set_partner_staff(%L, %L)$$, :manager, :'shop'), 'invalid_assignee', 'only "Partner shop" staff can be linked to a shop');
reset role;
select pg_temp.ok((select count(*) from public.admin_roles r join public.role_permissions rp on rp.role_id = r.id where r.key = 'super_admin' and rp.permission_key in ('partner.own', 'partners.manage')) = 2,
  'the Super Admin has the new permissions');

set role anon;
select pg_temp.ok((select address_line = 'Piassa, next to the post office' and fee_etb = 150 and city = 'Addis Ababa' from public.public_partner_shops() where id = :'shop'::uuid),
  'checkout lists the shop with its full address and the city price');
reset role;

-- Customer orders "pick up at Hawassa Corner"
set role service_role;
create temp table t_o as select public.create_order_for_user(:customer,
  pg_temp.order_payload(gen_random_uuid(), jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')
  || jsonb_build_object('fulfillment', jsonb_build_object('method', 'pickup', 'partner_shop_id', :'shop')) ) as r;
reset role;
select r ->> 'order_id' as oid from t_o \gset
select pg_temp.ok((select fulfillment_method = 'pickup' and partner_shop_id = :'shop'::uuid and delivery_fee_etb = 150 and city = 'Addis Ababa'
                          and partner_snapshot ->> 'landmark' = 'Blue gate' and address_line like 'Hawassa Corner — %' from public.orders where id = :'oid'::uuid),
  'order: pickup at the partner shop, city delivery price charged, shop address kept on the order');
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'oid'::uuid;

-- Dispatch + assign
select pg_temp.login(:manager);
select pg_temp.ok((select partner_shop = 'Hawassa Corner' and courier_pay_etb = 150 from public.admin_dispatch_orders() where order_id = :'oid'::uuid), 'dispatch lists partner shop orders');
select public.admin_assign_courier(:'oid'::uuid, :staff2);
reset role;
select handoff_courier_code as ccode, handoff_shop_code as scode, delivery_code as pin from public.orders where id = :'oid'::uuid \gset
select pg_temp.ok(:'ccode' ~ '^\d{4}$' and :'scode' ~ '^\d{4}$' and :'ccode' <> :'scode', 'two different hand-over PINs made');

-- Courier: sees the shop (not the customer), picks up; cannot "deliver" a shop order
select pg_temp.login(:staff2);
select pg_temp.ok((select partner_shop = 'Hawassa Corner' and customer_name is null and customer_phone is null and handoff_code is null from public.courier_deliveries() where order_id = :'oid'::uuid),
  'courier sees the partner shop, not the customer');
select public.courier_pick_up(:'oid'::uuid);
select pg_temp.ok((select handoff_code = :'ccode' from public.courier_deliveries() where order_id = :'oid'::uuid), 'courier sees their hand-over PIN once on the way');
select pg_temp.throws(format($$select public.courier_deliver(%L, %L)$$, :'oid', :'pin'), 'invalid_transition', 'shop orders are not delivered to the door');
reset role;

-- Shop: incoming, enters the courier's PIN (wrong, then right)
select pg_temp.login(:staff);
select pg_temp.ok((select stage = 'incoming' and shop_code = :'scode' and customer_name is null from public.partner_orders() where order_id = :'oid'::uuid),
  'Business app: incoming order with the shop PIN to give the courier');
select pg_temp.ok(not public.partner_receive(:'oid'::uuid, '0000') or :'ccode' = '0000', 'wrong courier PIN refused');
select pg_temp.ok(public.partner_receive(:'oid'::uuid, :'ccode'), 'shop enters the courier''s PIN');
select pg_temp.throws(format($$select public.partner_hand_over(%L, %L)$$, :'oid', :'pin'), 'invalid_transition', 'not at the shop until the courier enters the shop PIN too');
reset role;
select pg_temp.ok((select status = 'out_for_delivery' and handoff_shop_at is not null from public.orders where id = :'oid'::uuid), 'half done: still on the way');

-- Courier: enters the shop's PIN → at the shop, courier earns the city price
select pg_temp.login(:staff2);
select pg_temp.ok(public.courier_handoff(:'oid'::uuid, :'scode'), 'courier enters the shop''s PIN');
reset role;
select pg_temp.ok((select status = 'ready_for_pickup' and at_shop_at is not null from public.orders where id = :'oid'::uuid)
                  and (select amount_etb = 150 from public.courier_earnings where order_id = :'oid'::uuid)
                  and (select count(*) from public.notifications_outbox where event_type = 'delivery_update' and payload ->> 'step' = 'at_shop' and payload ->> 'order_id' = :'oid') = 1
                  and (select count(*) from public.notifications_outbox where event_type = 'customer_order_ready_for_pickup' and payload ->> 'order_id' = :'oid') = 1,
  'PINs checked both ways: ready at the shop, courier earned 150, office and customer told');

-- Shop: customer comes with their PIN
select pg_temp.login(:staff);
select pg_temp.ok((select stage = 'at_shop' and customer_name = 'Test Customer' and customer_phone is not null from public.partner_orders() where order_id = :'oid'::uuid),
  'at the shop: the customer''s name and phone (to call them)');
select pg_temp.ok(not public.partner_hand_over(:'oid'::uuid, case when :'pin' = '1111' then '2222' else '1111' end), 'wrong customer PIN refused');
select pg_temp.ok(public.partner_hand_over(:'oid'::uuid, :'pin'), 'right customer PIN: handed over');
select pg_temp.ok((public.partner_me() ->> 'unpaid_etb')::numeric = 50 and (select count(*) from public.partner_earnings) = 1, 'shop earns its handling fee (50)');
select pg_temp.ok((select count(*) from public.partner_shops) = 1 and (select count(*) from public.orders) = 0, 'shop staff read only their shop (not the orders table)');
select pg_temp.throws($$select public.admin_partner_shops()$$, 'forbidden', 'shop staff cannot open the admin list');
select pg_temp.throws($$select public.courier_deliveries()$$, 'forbidden', 'shop staff are not couriers');
reset role;
select pg_temp.ok((select status = 'completed' from public.orders where id = :'oid'::uuid), 'order completed');

select pg_temp.login(:staff2);
select pg_temp.throws($$select public.partner_orders()$$, 'forbidden', 'couriers cannot use the Business app');
select pg_temp.ok((select count(*) from public.partner_shops) = 0 and (select count(*) from public.partner_earnings) = 0, 'couriers see no shop data');
reset role;

-- Super Admin: pay the shop, Excel
select pg_temp.login(:super);
select pg_temp.ok((select unpaid_etb = 50 and collected_month = 1 and staff_count = 1 from public.admin_partner_shops() where id = :'shop'::uuid), 'admin list: unpaid 50, 1 collected, 1 staff');
create temp table t_pay as select public.admin_pay_partner(:'shop'::uuid, 'BANK-9') as r;
select pg_temp.ok((select (r ->> 'amount_etb')::numeric = 50 from t_pay), 'shop paid 50 ETB');
select pg_temp.ok((select shop_earned_etb = 50 and paid_out_at is not null and at_shop_at is not null from public.admin_partner_orders(now() - interval '1 day', now() + interval '1 day') where order_number = (select order_number from public.orders where id = :'oid'::uuid)),
  'partner orders Excel: shop, earned and paid out');
select public.admin_log_export('partner_orders', '{"rows":1}');
-- switch the shop off: checkout refuses it, Business app closed
select public.admin_save_partner_shop(:'shop'::uuid, '{"name":"Hawassa Corner","zone_id":"40000000-0000-0000-0000-000000000001","address_line":"Piassa, next to the post office","phone":"+251462201122","handling_fee_etb":"50","is_active":false}');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_pay_partner('00000000-0000-0000-0000-000000000000')$$, 'forbidden', 'managers cannot pay partner shops');
reset role;
set role service_role;
select pg_temp.throws(format($$select public.create_order_for_user(%L, %L::jsonb)$$, :customer,
  pg_temp.order_payload(gen_random_uuid(), jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')
  || jsonb_build_object('fulfillment', jsonb_build_object('method', 'pickup', 'partner_shop_id', :'shop'))), 'invalid_pickup_point', 'a switched-off shop cannot be chosen');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws($$select public.partner_me()$$, 'forbidden', 'switched-off shop: Business app closed');
reset role;

-- Hand-over lock: 5 wrong PINs, unlocked by re-assigning the courier
update public.partner_shops set is_active = true where id = :'shop'::uuid;
set role service_role;
create temp table t_o2 as select public.create_order_for_user(:customer,
  pg_temp.order_payload(gen_random_uuid(), jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')
  || jsonb_build_object('fulfillment', jsonb_build_object('method', 'pickup', 'partner_shop_id', :'shop')) ) as r;
reset role;
select r ->> 'order_id' as oid2 from t_o2 \gset
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'oid2'::uuid;
select pg_temp.login(:manager);
select public.admin_assign_courier(:'oid2'::uuid, :staff2);
reset role;
select handoff_shop_code as scode2 from public.orders where id = :'oid2'::uuid \gset
select pg_temp.login(:staff2);
select public.courier_pick_up(:'oid2'::uuid);
select public.courier_handoff(:'oid2'::uuid, lpad(((:'scode2'::int + n) % 10000)::text, 4, '0')) from generate_series(1, 5) n;
select pg_temp.throws(format($$select public.courier_handoff(%L, %L)$$, :'oid2', :'scode2'), 'handoff_locked', '5 wrong hand-over PINs lock it');
reset role;
select pg_temp.login(:manager);
select public.admin_assign_courier(:'oid2'::uuid, :staff2);
reset role;
select pg_temp.login(:staff2);
select pg_temp.ok(public.courier_handoff(:'oid2'::uuid, :'scode2'), 're-assigning the same courier unlocks it (same PINs)');
reset role;
rollback;
