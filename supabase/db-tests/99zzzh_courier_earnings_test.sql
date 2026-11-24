-- 0070 + 0071: couriers — cities on duty, vehicle & documents, delivery discount steps, pay = full city price,
-- decline, payouts, notifications, HR details, ringtone, courier orders Excel. Duty changes are not alerted.
\ir _helpers.sql
update public.profiles set role_id = (select id from public.admin_roles where key = 'courier') where id = :staff2;
-- Discount steps: 2+ items 10 %, 3+ items 20 % (Addis Ababa = 150 ETB in the test data).
update public.website_settings set value = value || '{"delivery_discounts": [{"min_items": 2, "percent": 10}, {"min_items": 3, "percent": 20}]}' where key = 'delivery';
select pg_temp.ok(private.delivery_discount_pct(1) = 0 and private.delivery_discount_pct(2) = 10 and private.delivery_discount_pct(5) = 20, 'discount steps by number of items');

set role service_role;
create temp table t_o as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 3)), 'delivery')) as r;
reset role;
select r ->> 'order_id' as oid from t_o \gset
select pg_temp.ok((select delivery_fee_etb = 120 and delivery_fee_full_etb = 150 and total_etb = subtotal_etb + 120 from public.orders where id = :'oid'::uuid),
  '3 items: customer pays 120 ETB delivery (20 % off 150); the order keeps the full city price 150');
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'oid'::uuid;

-- going on duty needs cities; duty changes are not Telegram alerts
select pg_temp.login(:staff2);
select pg_temp.ok((select count(*) from public.courier_cities() where name_en = 'Addis Ababa') = 1 and (select count(*) from public.courier_cities() where name_en = 'Lalibela') = 0,
  'courier chooses from the active delivery cities (Ethiopian city list added switched off)');
select pg_temp.throws($$select public.courier_set_duty(true, '{}')$$, 'invalid_request', 'going on duty needs at least one city');
select public.courier_set_duty(true, array['40000000-0000-0000-0000-000000000001'::uuid]);
reset role;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'admin_action' and payload ->> 'action' like 'courier_%_duty') = 0,
  'going on / off duty is not a Telegram alert');

-- dispatch: available couriers for the order's city
select pg_temp.login(:manager);
select pg_temp.ok((select zone_id = '40000000-0000-0000-0000-000000000001' and courier_pay_etb = 150 and delivery_fee_etb = 120 from public.admin_dispatch_orders() where order_id = :'oid'::uuid),
  'dispatch: city, courier pay (full price) and the discounted fee');
select pg_temp.ok((select on_duty and '40000000-0000-0000-0000-000000000001'::uuid = any(zone_ids) and cities = 'Addis Ababa' from public.admin_couriers() where id = :staff2),
  'couriers list: online for Addis Ababa');
select pg_temp.throws(format($$select public.admin_update_courier(%L, '{"vehicle":"car"}')$$, :staff2), 'forbidden', 'managers cannot edit courier documents (Super Admin)');
select public.admin_assign_courier(:'oid'::uuid, :staff2);
reset role;

-- vehicle & documents (Super Admin): motorcycle / car need make, model, plate, insurance and licence
select pg_temp.login(:super);
select pg_temp.throws(format($$select public.admin_update_courier(%L, '{"vehicle":"motorcycle","plate_number":"AA-1"}')$$, :staff2), 'invalid_request', 'motorcycle without documents is refused');
select public.admin_update_courier(:staff2, '{"vehicle":"motorcycle","vehicle_make":"Bajaj","vehicle_model":"Boxer","plate_number":"aa-123","insurance_company":"Nyala","insurance_policy":"P-1","insurance_expiry":"2027-12-31","licence_number":"dl-9","licence_expiry":"2028-01-31","phone":"+251911000111"}');
select pg_temp.ok((select vehicle = 'motorcycle' and plate_number = 'AA-123' and licence_number = 'DL-9' from public.admin_couriers() where id = :staff2), 'motorcycle with documents saved');
select public.admin_update_courier(:staff2, '{"vehicle":"bicycle","plate_number":"X"}');
select pg_temp.ok((select vehicle = 'bicycle' and plate_number is null and licence_number is null from public.admin_couriers() where id = :staff2), 'bicycle: no vehicle documents kept');
reset role;

-- courier: decline → back to dispatch, off duty
select pg_temp.login(:staff2);
select pg_temp.throws(format($$select public.courier_decline(%L, 'x')$$, :'oid'), 'invalid_reason', 'declining needs a reason');
select public.courier_decline(:'oid'::uuid, 'Flat tyre');
select pg_temp.ok(not (public.courier_me() ->> 'on_duty')::boolean, 'declined: the courier is set off duty');
reset role;
select pg_temp.ok((select courier_id is null from public.orders where id = :'oid'::uuid)
                  and (select count(*) from public.notifications_outbox where event_type = 'delivery_update' and payload ->> 'step' = 'declined' and payload ->> 'reason' = 'Flat tyre') = 1,
  'declined: back to dispatch, office told with the reason');

-- deliver: earns the full city price
select pg_temp.login(:manager);
select public.admin_assign_courier(:'oid'::uuid, :staff2);
reset role;
select pg_temp.login(:staff2);
select pg_temp.ok((select count(*) from public.courier_notifications where kind = 'assigned') = 2 and (public.courier_me() ->> 'latest_unread_assigned') is not null,
  'courier notified (and the app rings for the latest unread delivery)');
select public.courier_pick_up(:'oid'::uuid);
reset role;
select delivery_code as code from public.orders where id = :'oid'::uuid \gset
select pg_temp.login(:staff2);
select public.courier_deliver(:'oid'::uuid, :'code');
select pg_temp.ok((select count(*) || ':' || sum(amount_etb) from public.courier_earnings) = '1:150.00', 'delivered: courier earns the full city price (150), not the discounted 120');
select public.courier_update_details('+251911000222');
select pg_temp.ok(public.courier_me() ->> 'phone' = '+251911000222', 'courier updates their phone');
reset role;

-- payout, Excel, ringtone, HR
select pg_temp.login(:super);
create temp table t_pay as select public.admin_pay_courier(:staff2, 'CASH-1', 'November') as r;
select pg_temp.ok((select courier_earned_etb = 150 and paid_out_at is not null and courier_user_id = (select member_id::text from public.customer_accounts where id = :staff2)
                   from public.admin_courier_orders(now() - interval '1 day', now() + interval '1 day') where order_number = (select order_number from public.orders where id = :'oid'::uuid)),
  'courier orders Excel: courier, earned and paid out');
select public.admin_log_export('courier_orders', '{"rows":1}');
select pg_temp.throws($$select public.admin_set_courier_ringtone('../x.mp3')$$, 'invalid_request', 'only an uploaded ringtone path');
select public.admin_set_courier_ringtone('ringtones/11111111-1111-1111-1111-111111111111.mp3');
select public.admin_save_staff_hr(:staff2, '{"fayda_number":"123456789012","passport_number":"ep1234567","job_title":"Courier","emergency_name":"Mum","emergency_phone":"+251911000333","start_date":"2026-11-01"}');
reset role;
select pg_temp.ok((select passport_number = 'EP1234567' and fayda_number = '123456789012' from public.staff_hr where profile_id = :staff2), 'HR details saved (Fayda, passport)');
select pg_temp.ok((select count(*) from public.audit_logs where action = 'staff_hr_updated' and metadata::text like '%123456789012%') = 0
                  and (select count(*) from public.audit_logs where action = 'staff_hr_updated') = 1, 'HR change logged without the ID numbers');
select pg_temp.login(:staff2);
select pg_temp.ok(public.courier_me() ->> 'ringtone_path' = 'ringtones/11111111-1111-1111-1111-111111111111.mp3', 'courier app gets the ringtone');
select pg_temp.ok((select count(*) from public.staff_hr) = 1, 'staff see their own HR details');
reset role;
select pg_temp.login(:staff);
select pg_temp.ok((select count(*) from public.staff_hr) = 0, 'other staff cannot see HR details');
select pg_temp.throws(format($$select public.admin_save_staff_hr(%L, '{}')$$, :staff2), 'forbidden', 'staff cannot edit HR details');
reset role;
select pg_temp.login(:staff2);
select pg_temp.throws($$select public.admin_pay_courier('aaaaaaaa-0000-0000-0000-000000000004')$$, 'forbidden', 'couriers cannot pay themselves');
select pg_temp.throws($$insert into public.courier_earnings (courier_id, order_id, order_number, amount_etb) values ('aaaaaaaa-0000-0000-0000-000000000004', gen_random_uuid(), 'X', 1)$$,
  '%permission denied%', 'nobody writes earnings directly');
reset role;
rollback;
