-- Customer account management: deactivation, delete guard, activity, baskets, stalled checkouts
\ir _helpers.sql

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_set_customer_active('cccccccc-0000-0000-0000-000000000002', false, 'spam')$$,
  'forbidden', 'managers cannot deactivate customers by default');
select pg_temp.throws($$select public.admin_prepare_customer_delete('cccccccc-0000-0000-0000-000000000002')$$,
  'forbidden', 'managers cannot delete customers by default');
select pg_temp.throws($$select public.admin_log_customer_action('cccccccc-0000-0000-0000-000000000002', 'password_reset_sent')$$,
  'forbidden', 'managers cannot send resets by default');
select pg_temp.throws($$select * from public.admin_activity_log()$$, 'forbidden', 'managers cannot read the global activity log');
select pg_temp.ok((select count(*) >= 0 from public.admin_stalled_checkouts(2)), 'managers can see stalled checkouts');
reset role;
select pg_temp.login(:customer);
select pg_temp.throws($$select public.admin_set_customer_active('cccccccc-0000-0000-0000-000000000002', false, 'x')$$,
  'forbidden', 'customers cannot deactivate accounts');
select pg_temp.throws($$select * from public.admin_customer_activity('cccccccc-0000-0000-0000-000000000002')$$,
  'forbidden', 'customers cannot read activity');
reset role;
set role anon;
select pg_temp.throws($$select public.admin_set_customer_active('cccccccc-0000-0000-0000-000000000002', false, 'x')$$,
  '%permission denied%', 'anon cannot call account management');
reset role;

-- ---------------------------------------------------------------------------
-- Staff accounts are not managed here
-- ---------------------------------------------------------------------------
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_set_customer_active('aaaaaaaa-0000-0000-0000-000000000003', false, 'x')$$,
  'cannot_manage_staff', 'staff accounts cannot be deactivated as customers');
select pg_temp.throws($$select public.admin_prepare_customer_delete('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'cannot_manage_staff', 'staff accounts cannot be deleted as customers');
select pg_temp.throws($$select public.admin_set_customer_active('dddddddd-0000-0000-0000-000000000009', false, 'x')$$,
  'user_not_found', 'unknown user');
select pg_temp.throws($$select public.admin_set_customer_active('cccccccc-0000-0000-0000-000000000001', false, '  ')$$,
  'invalid_reason', 'deactivation needs a reason');
reset role;

-- ---------------------------------------------------------------------------
-- Baskets (own rows only) and orders empty the basket
-- ---------------------------------------------------------------------------
select pg_temp.login(:customer);
insert into public.customer_carts (user_id, items)
values (:customer, '[{"product_id":"20000000-0000-0000-0000-000000000007","quantity":2}]');
select pg_temp.ok((select item_count from public.customer_carts where user_id = :customer) = 2, 'basket item count is computed');
select pg_temp.throws($$insert into public.customer_carts (user_id, items) values ('cccccccc-0000-0000-0000-000000000002', '[]')$$,
  '%row-level security%', 'cannot save a basket for someone else');
select pg_temp.throws($$update public.customer_carts set items = '[{"product_id":"x","quantity":1}]'$$,
  '%check constraint%', 'basket contents are validated');
select pg_temp.throws($$update public.customer_carts set item_count = 0$$, '%permission denied%', 'item count is not writable');
select pg_temp.throws($$update public.customer_carts set user_id = 'cccccccc-0000-0000-0000-000000000002'$$, '%row-level security%', 'a basket cannot be moved to another account');
reset role;
select pg_temp.login(:customer2);
select pg_temp.ok((select count(*) from public.customer_carts) = 0, 'customers only see their own basket');
insert into public.customer_carts (user_id, items)
values (:customer2, '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]');
reset role;
alter table public.customer_carts disable trigger customer_carts_touch;
update public.customer_carts set updated_at = now() - interval '3 hours';
alter table public.customer_carts enable trigger customer_carts_touch;

set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload('f7000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))));
reset role;
select pg_temp.ok(not exists (select 1 from public.customer_carts where user_id = :customer), 'placing an order empties the basket');
set constraints all immediate; -- run deferred checks before altering the table (test-only backdating)
alter table public.orders disable trigger orders_updated_at;
update public.orders set updated_at = now() - interval '3 hours' where idempotency_key = 'f7000000-0000-0000-0000-000000000001';
alter table public.orders enable trigger orders_updated_at;

select pg_temp.login(:manager);
create temp table t_stalled as select * from public.admin_stalled_checkouts(2);
select pg_temp.ok((select count(*) from t_stalled where kind = 'basket' and user_id = :customer2 and item_count = 1 and amount_etb > 0) = 1,
  'abandoned basket older than 2h is listed with its value');
select pg_temp.ok((select count(*) from t_stalled where kind = 'unpaid_order' and user_id = :customer) = 1,
  'unpaid order older than 2h is listed');
select pg_temp.ok((select count(*) from public.admin_stalled_checkouts(5) where user_id in (:customer, :customer2)) = 0,
  'threshold is respected');
reset role;

-- ---------------------------------------------------------------------------
-- Profile changes are recorded
-- ---------------------------------------------------------------------------
select pg_temp.login(:customer);
update public.customer_accounts set phone = '+251911000111' where id = :customer;
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where entity_type = 'customer_account' and entity_id = :customer::text
  and action = 'profile_updated' and actor_id = :customer and after_data ->> 'phone' = '+251911000111') = 1, 'own phone change is audited');

-- ---------------------------------------------------------------------------
-- Deactivation
-- ---------------------------------------------------------------------------
select pg_temp.login(:super);
select public.admin_set_customer_active(:customer, false, 'Fraudulent receipts');
select public.admin_set_customer_active(:customer, false, 'again'); -- no-op
reset role;
select pg_temp.ok((select deactivated_by = :super and deactivation_reason = 'Fraudulent receipts' from public.customer_accounts where id = :customer),
  'deactivation recorded with who and why');
select pg_temp.ok((select count(*) from public.audit_logs where action = 'customer_deactivated' and entity_id = :customer::text) = 1,
  'deactivation audited once');

set role service_role;
select pg_temp.throws($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload('f7000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))$$,
  'account_deactivated', 'deactivated customers cannot order');
select pg_temp.throws($$select public.create_printing_job_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.job_payload('f7000000-0000-0000-0000-0000000000aa', 3))$$,
  'account_deactivated', 'deactivated customers cannot submit printing jobs');
reset role;

select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.orders) = 0, 'deactivated customers cannot read their orders');
select pg_temp.ok((select count(*) from public.order_items) = 0, 'deactivated customers cannot read order items');
update public.customer_accounts set full_name = 'Hacked' where id = :customer;
select pg_temp.throws($$insert into public.customer_carts (user_id, items) values ('cccccccc-0000-0000-0000-000000000001', '[]')$$,
  '%row-level security%', 'deactivated customers cannot save a basket');
reset role;
select pg_temp.ok((select full_name is distinct from 'Hacked' from public.customer_accounts where id = :customer),
  'deactivated customers cannot edit their profile');

-- A Supabase ban alone also blocks ordering
update auth.users set banned_until = now() + interval '100 years' where id = :customer2;
set role service_role;
select pg_temp.throws($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000002', pg_temp.order_payload('f7000000-0000-0000-0000-000000000003',
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))$$,
  'account_deactivated', 'banned users cannot order');
reset role;
update auth.users set banned_until = null where id = :customer2;

select pg_temp.login(:super);
select public.admin_set_customer_active(:customer, true);
reset role;
select pg_temp.ok((select deactivated_at is null and deactivation_reason is null from public.customer_accounts where id = :customer), 'reactivated');
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.orders) = 1, 'reactivated customers see their orders again');
reset role;

-- ---------------------------------------------------------------------------
-- Delete guard and logging
-- ---------------------------------------------------------------------------
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_prepare_customer_delete('cccccccc-0000-0000-0000-000000000001')$$,
  'has_orders', 'accounts with orders cannot be deleted');
select pg_temp.ok((select public.admin_prepare_customer_delete(:customer2) ->> 'email') = 'customer2@test.local', 'delete snapshot');
select pg_temp.throws($$select public.admin_log_customer_action('cccccccc-0000-0000-0000-000000000002', 'customer_deleted', '{}')$$,
  'invalid_request', 'cannot log a deletion for an account that still exists');
select pg_temp.throws($$select public.admin_log_customer_action('cccccccc-0000-0000-0000-000000000002', 'role_changed', '{}')$$,
  'invalid_request', 'only known actions can be logged');
select public.admin_log_customer_action(:customer2, 'password_reset_sent', '{}');
reset role;
delete from auth.users where id = :customer2;
select pg_temp.login(:super);
select public.admin_log_customer_action(:customer2, 'customer_deleted', '{"email":"customer2@test.local"}');
create temp table t_log as select * from public.admin_activity_log('customer_account');
select pg_temp.ok((select actor_name from t_log where action = 'customer_deactivated' limit 1) = 'Test Super', 'activity log names the actor');
select pg_temp.ok((select entity_label from t_log where action = 'customer_deleted') = 'customer2@test.local', 'deleted accounts keep their email label');
select pg_temp.ok((select count(*) from public.admin_activity_log(null, 'password_reset')) = 1, 'activity log search');

-- Timeline
reset role;
insert into auth.audit_log_entries (payload) values
  (json_build_object('action', 'login', 'actor_id', 'cccccccc-0000-0000-0000-000000000001')),
  (json_build_object('action', 'token_refreshed', 'actor_id', 'cccccccc-0000-0000-0000-000000000001'));
select pg_temp.login(:super);
create temp table t_act as select * from public.admin_customer_activity(:customer);
select pg_temp.ok((select count(*) from t_act where kind = 'admin' and action in ('customer_deactivated', 'customer_reactivated')) = 2, 'timeline: admin actions');
select pg_temp.ok((select count(*) from t_act where kind = 'account' and action = 'profile_updated') = 1, 'timeline: own changes');
select pg_temp.ok((select count(*) from t_act where kind = 'auth' and action = 'login') = 1, 'timeline: sign-ins');
select pg_temp.ok((select count(*) from t_act where action = 'token_refreshed') = 0, 'timeline: token noise is hidden');
select pg_temp.ok((select count(*) from t_act where kind = 'order' and action = 'order_placed') = 1, 'timeline: purchases');
reset role;
rollback;
