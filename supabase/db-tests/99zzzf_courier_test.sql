-- 0068: couriers deliver only their own assigned orders; customer's code at the door; every step logged.
\ir _helpers.sql
-- staff2 becomes a courier
update public.profiles set role_id = (select id from public.admin_roles where key = 'courier') where id = :staff2;

set role service_role;
create temp table t_o as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'delivery')) as r;
create temp table t_pick as select public.create_order_for_user(:customer2, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')) as r;
reset role;
select r ->> 'order_id' as oid from t_o \gset
select r ->> 'order_id' as pid from t_pick \gset
-- paid
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'oid'::uuid;

select pg_temp.login(:staff2);
select pg_temp.ok((select (public.my_staff_status() ->> 'role')) = 'courier', 'my_staff_status tells the permission set (courier)');
select pg_temp.ok((select count(*) from public.courier_deliveries()) = 0, 'courier sees nothing before an order is assigned');
select pg_temp.ok((select count(*) from public.orders) = 0, 'couriers cannot read the orders table');
reset role;

-- assigning: managers only, couriers only, delivery orders only
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_assign_courier(%L, %L)$$, :'oid'::uuid, :staff2), 'forbidden', 'staff cannot assign couriers');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws(format($$select public.admin_assign_courier(%L, %L)$$, :'oid'::uuid, :staff), 'invalid_assignee', 'only a courier can be assigned');
select pg_temp.throws(format($$select public.admin_assign_courier(%L, %L)$$, :'pid', :staff2), 'invalid_request', 'pickup orders have no courier');
select public.admin_assign_courier(:'oid'::uuid, :staff2);
reset role;
select pg_temp.ok((select delivery_code ~ '^[0-9]{4}$' and courier_id = :staff2 from public.orders where id = :'oid'::uuid), 'assigned: a 4-digit delivery code is made for the customer');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'delivery_update' and payload ->> 'step' = 'assigned'
                     and payload ->> 'courier_user_id' = (select member_id::text from public.customer_accounts where id = :staff2)) = 1,
  'assignment announced in Telegram with the courier''s User ID');

-- courier sees the contact details while the delivery is open
select pg_temp.login(:staff2);
select pg_temp.ok((select customer_phone is not null and address_line is not null and active from public.courier_deliveries()), 'courier sees phone and address of the assigned delivery');
select pg_temp.throws(format($$select public.courier_deliver(%L, '0000')$$, :'oid'::uuid), 'invalid_transition', 'cannot deliver before picking up');
select public.courier_pick_up(:'oid'::uuid);
reset role;
select pg_temp.ok((select status::text from public.orders where id = :'oid'::uuid) = 'out_for_delivery', 'picked up → out for delivery (customer is told)');

-- another courier / staff cannot touch it
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.courier_pick_up(%L)$$, :'oid'::uuid), 'forbidden', 'non-couriers cannot use the courier functions');
reset role;

-- wrong code counted; right code delivers
select pg_temp.login(:staff2);
select public.courier_deliver(:'oid'::uuid, 'abcd') as wrong_ok \gset
reset role;
select pg_temp.ok(:'wrong_ok'::boolean = false and (select delivery_code_tries from public.orders where id = :'oid'::uuid) = 1, 'wrong code: refused and counted');
select delivery_code as code from public.orders where id = :'oid'::uuid \gset
select pg_temp.login(:staff2);
select public.courier_deliver(:'oid'::uuid, :'code') as right_ok \gset
reset role;
select pg_temp.ok(:'right_ok'::boolean and (select status::text = 'completed' and delivered_at is not null from public.orders where id = :'oid'::uuid),
  'right code: delivered → completed');
select pg_temp.login(:staff2);
select pg_temp.ok((select customer_phone is null and address_line is null and not active from public.courier_deliveries()), 'after delivery the courier no longer sees phone or address');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where entity_id = :'oid'
                     and action in ('courier_assigned', 'delivery_picked_up', 'delivery_completed')) = 3, 'every step in the Activity log');

-- could not deliver; 5 wrong codes lock
set role service_role;
create temp table t_o2 as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'delivery')) as r;
reset role;
select r ->> 'order_id' as oid2 from t_o2 \gset
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'oid2'::uuid;
select pg_temp.login(:manager);
select public.admin_assign_courier(:'oid2'::uuid, :staff2);
reset role;
select pg_temp.login(:staff2);
select public.courier_pick_up(:'oid2'::uuid);
select pg_temp.throws(format($$select public.courier_fail(%L, 'x')$$, :'oid2'::uuid), 'invalid_reason', 'a reason is needed');
select public.courier_fail(:'oid2'::uuid, 'Customer not answering');
reset role;
select pg_temp.ok((select status::text = 'processing' and delivery_fail_reason = 'Customer not answering' and delivery_attempts = 1 from public.orders
                   where id = :'oid2'::uuid), 'could not deliver: back to preparing, reason kept');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'delivery_update' and payload ->> 'step' = 'failed' and payload ->> 'reason' = 'Customer not answering') = 1,
  'failed delivery announced with the reason');
select pg_temp.login(:staff2);
select public.courier_pick_up(:'oid2'::uuid);
select count(public.courier_deliver(:'oid2'::uuid, 'zzzz')) from generate_series(1, 5);
select pg_temp.throws(format($$select public.courier_deliver(%L, '0000')$$, :'oid2'::uuid), 'delivery_locked', '5 wrong codes lock the delivery');
reset role;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'delivery_update' and payload ->> 'step' = 'code_locked') = 1, 'lock announced');
select pg_temp.login(:manager);
select public.admin_assign_courier(:'oid2'::uuid, :staff2);
reset role;
select pg_temp.ok((select delivery_code_tries from public.orders where id = :'oid2'::uuid) = 0, 're-assigning unlocks the code');
rollback;
