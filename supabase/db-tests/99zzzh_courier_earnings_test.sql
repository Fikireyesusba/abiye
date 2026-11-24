-- 0070: courier details, on duty, fixed fee per delivery, payouts, notifications, dispatch list.
\ir _helpers.sql
update public.profiles set role_id = (select id from public.admin_roles where key = 'courier') where id = :staff2;
set role service_role;
create temp table t_o as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'delivery')) as r;
reset role;
select r ->> 'order_id' as oid from t_o \gset
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = :'oid'::uuid;

-- dispatch list (orders.manage) shows the paid delivery order without a courier
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.admin_dispatch_orders() where order_id = :'oid'::uuid) = 1, 'dispatch: paid delivery order waiting for a courier');
select pg_temp.throws($$select public.admin_set_courier_fee(150)$$, 'forbidden', 'managers cannot change the courier fee (Super Admin)');
select public.admin_assign_courier(:'oid'::uuid, :staff2);
select pg_temp.ok((select count(*) from public.admin_dispatch_orders() where order_id = :'oid'::uuid) = 0, 'dispatch: gone once a courier has it');
reset role;

-- courier: notification, details, on duty
select pg_temp.login(:staff2);
select pg_temp.ok((select count(*) from public.courier_notifications where kind = 'assigned' and read_at is null) = 1, 'courier is notified of the new delivery');
select public.courier_update_details('+251911000111', 'motorbike', 'aa-123');
select public.courier_set_duty(true);
select pg_temp.ok((select (public.courier_me() ->> 'on_duty')::boolean and public.courier_me() ->> 'plate_number' = 'AA-123'
                     and (public.courier_me() ->> 'fee_etb')::numeric = 100 and (public.courier_me() ->> 'unread')::int = 1), 'courier: details, on duty, fee 100 ETB, 1 unread');
select public.courier_mark_notifications_read();
select pg_temp.ok((public.courier_me() ->> 'unread')::int = 0, 'notifications marked read');
select public.courier_pick_up(:'oid'::uuid);
reset role;
select delivery_code as code from public.orders where id = :'oid'::uuid \gset
select pg_temp.login(:staff2);
select public.courier_deliver(:'oid'::uuid, :'code');
select pg_temp.ok((select count(*) || ':' || sum(amount_etb) from public.courier_earnings) = '1:100.00', 'delivered: earns the fixed fee (100 ETB), visible to the courier');
select pg_temp.ok((public.courier_me() ->> 'unpaid_etb')::numeric = 100 and (public.courier_me() ->> 'today_delivered')::int = 1, 'earnings: today and to be paid');
reset role;

-- other staff cannot see courier earnings
select pg_temp.login(:staff);
select pg_temp.ok((select count(*) from public.courier_earnings) = 0, 'other staff cannot see courier earnings');
reset role;

-- Super Admin: fee, own fee, payout
select pg_temp.login(:super);
select public.admin_set_courier_fee(120);
select public.admin_update_courier(:staff2, '+251911000111', 'car', 'AB-1', 90);
select pg_temp.ok((select fee_etb = 90 and fee_override_etb = 90 and unpaid_etb = 100 and delivered_total = 1 from public.admin_couriers() where id = :staff2),
  'couriers list: own fee 90, 100 ETB to pay, 1 delivered');
create temp table t_pay as select public.admin_pay_courier(:staff2, 'CASH-1', 'November') as r;
select pg_temp.throws(format($$select public.admin_pay_courier(%L)$$, :staff2), 'invalid_amount', 'nothing left to pay');
reset role;
select pg_temp.ok((select (r ->> 'amount_etb')::numeric = 100 and (r ->> 'deliveries')::int = 1 from t_pay)
                  and (select count(*) from public.courier_earnings where payout_id is null) = 0, 'Mark as paid: one payout, earnings linked');
select pg_temp.ok((select count(*) from public.courier_notifications where courier_id = :staff2 and kind = 'payout') = 1, 'courier is notified of the payment');
select pg_temp.ok((select count(*) from public.audit_logs where action in ('courier_paid', 'courier_fee_set', 'courier_on_duty')) = 3, 'fee, payout and duty changes in the Activity log');
select pg_temp.login(:staff2);
select pg_temp.throws($$select public.admin_pay_courier('aaaaaaaa-0000-0000-0000-000000000004')$$, 'forbidden', 'couriers cannot pay themselves');
select pg_temp.throws($$insert into public.courier_earnings (courier_id, order_id, order_number, amount_etb) values ('aaaaaaaa-0000-0000-0000-000000000004', gen_random_uuid(), 'X', 1)$$,
  '%permission denied%', 'nobody writes earnings directly');
reset role;
rollback;
