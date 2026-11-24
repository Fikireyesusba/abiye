-- 0074: couriers / shops see the order number and customer name only; wrong PINs logged and alerted;
-- late deliveries alerted once per step; monitor page and thresholds.
\ir _helpers.sql
update public.profiles set role_id = (select id from public.admin_roles where key = 'courier') where id = :staff2;
update public.website_settings set value = value || '{"delivery_discounts": []}' where key = 'delivery';

set role service_role;
create temp table t_o as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'delivery')) as r;
reset role;
select r ->> 'order_id' as oid from t_o \gset
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() - interval '3 hours' where id = :'oid'::uuid;

-- late: paid 3 h ago, no courier (default limit 2 h)
select pg_temp.ok((select kind from private.delivery_overdue() where order_id = :'oid'::uuid) = 'not_dispatched', 'paid 3 h ago without a courier is late');
select private.delivery_monitor_scan();
select private.delivery_monitor_scan();
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'delivery_alert' and payload ->> 'order_id' = :'oid' and payload ->> 'kind' = 'not_dispatched') = 1,
  'one alert per order and problem (not repeated by the next check)');

-- the tick: staff only, at most every 5 minutes
select pg_temp.login(:outsider);
select pg_temp.ok(public.delivery_monitor_tick() = 0, 'non-staff accounts do not run the check');
reset role;
select pg_temp.login(:manager);
select public.delivery_monitor_tick();
select pg_temp.ok(public.delivery_monitor_tick() = 0, 'the check runs at most every 5 minutes');
select public.admin_assign_courier(:'oid'::uuid, :staff2);
reset role;

-- courier: number and customer name only (no products / prices)
select pg_temp.login(:staff2);
select pg_temp.ok((select customer_name = 'Test Customer' and order_number is not null from public.courier_deliveries() where order_id = :'oid'::uuid), 'courier sees the order number and the customer name');
select public.courier_pick_up(:'oid'::uuid);
reset role;
select pg_temp.ok(not exists (select 1 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
                               where r.routine_name in ('courier_deliveries', 'partner_orders') and p.parameter_mode = 'OUT' and p.parameter_name in ('items', 'total_etb')),
  'the courier and Business app lists have no products or prices');

-- wrong PINs: each one logged, alert at the 3rd (default), into the security group
select delivery_code as pin from public.orders where id = :'oid'::uuid \gset
select pg_temp.login(:staff2);
select public.courier_deliver(:'oid'::uuid, lpad(((:'pin'::int + n) % 10000)::text, 4, '0')) from generate_series(1, 3) n;
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'pin_wrong' and entity_id = :'oid') = 3, 'every wrong PIN is in the log');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'delivery_pin_alert' and payload ->> 'order_id' = :'oid' and (payload ->> 'tries')::int = 3
                     and channel = 'telegram' and payload ->> 'pin' = 'customer_pin_at_door') = 1
                  and private.telegram_group('delivery_pin_alert') = 'security',
  '3rd wrong PIN: security alert');

-- on the way too long
update public.orders set picked_up_at = now() - interval '7 hours' where id = :'oid'::uuid;
select pg_temp.ok((select kind from private.delivery_overdue() where order_id = :'oid'::uuid) = 'delivery_late', 'on the way 7 h (limit 6 h) is late');

-- monitor page and settings
select pg_temp.login(:manager);
select pg_temp.ok((public.admin_delivery_monitor() -> 'counts' ->> 'wrong_pins_today')::int >= 3
                  and jsonb_array_length(public.admin_delivery_monitor() -> 'overdue') >= 1
                  and exists (select 1 from jsonb_array_elements(public.admin_delivery_monitor() -> 'events') e where e ->> 'action' = 'pin_wrong'),
  'monitor: counts, late orders and the app log');
select pg_temp.throws($$select public.admin_set_delivery_monitor('{"dispatch_wait_hours":1,"pickup_hours":1,"delivery_hours":1,"shop_collect_days":2,"wrong_pin_alert":2}')$$, 'forbidden',
  'managers cannot change the alert settings');
reset role;
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_set_delivery_monitor('{"dispatch_wait_hours":1,"pickup_hours":1,"delivery_hours":1,"shop_collect_days":2,"wrong_pin_alert":5}')$$, 'invalid_request',
  'wrong-PIN alert must be below the lock (5)');
select public.admin_set_delivery_monitor('{"enabled":true,"dispatch_wait_hours":1,"pickup_hours":1,"delivery_hours":8,"shop_collect_days":2,"wrong_pin_alert":2}');
reset role;
select pg_temp.ok(private.monitor_setting('delivery_hours', 6) = 8 and not exists (select 1 from private.delivery_overdue() where order_id = :'oid'::uuid),
  'Super Admin sets the limits (8 h: no longer late)');
select pg_temp.login(:staff2);
select pg_temp.throws($$select public.admin_delivery_monitor()$$, 'forbidden', 'couriers cannot open the monitor');
reset role;
rollback;
