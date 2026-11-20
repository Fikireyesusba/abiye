-- Export everything; reset test data (Super Admin only, export first, exact phrase)
\ir _helpers.sql
update auth.users set email_confirmed_at = now() where id in (:customer, :customer2);

-- some test data
select public.create_order_for_user(:customer, pg_temp.order_payload('d3000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 2))));
select public.create_printing_job_for_user(:customer, pg_temp.job_payload('c3000000-0000-0000-0000-000000000001', 3));
update public.orders set status = 'completed', payment_status = 'verified', payment_verified_at = now() where idempotency_key = 'd3000000-0000-0000-0000-000000000001';
-- activity by a customer (its actor is removed with the account)
insert into public.audit_logs (actor_id, action, entity_type, entity_id) values (:customer, 'profile_updated', 'customer_account', :customer);
create temp table t_before as select
  (select count(*) from public.products) as products, (select count(*) from public.categories) as categories,
  (select count(*) from public.bank_accounts) as banks, (select count(*) from public.profiles) as staff,
  (select count(*) from public.delivery_zones) as zones, (select stock_quantity from public.products where id = :charger) as stock;
grant select on t_before to authenticated;

-- export: Super Admin only; secrets never exported
select pg_temp.login(:manager);
select pg_temp.throws($$select * from public.admin_data_export('orders')$$, 'forbidden', 'managers cannot export everything');
select pg_temp.throws($$select public.admin_reset_test_data('x')$$, 'forbidden', 'managers cannot reset');
reset role;
select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_data_export('orders')) >= 1, 'orders exported');
select pg_temp.ok(not exists (select 1 from public.admin_data_export('orders') r where r ? 'access_token_hash' or r ? 'tracking_code_hash' or r ? 'idempotency_key'),
                  'order secrets are not exported');
select pg_temp.ok(not exists (select 1 from public.admin_data_export('printing_jobs') r where r ? 'access_token_hash'), 'printing secrets are not exported');
select pg_temp.ok((select bool_and(r ? 'email') from public.admin_data_export('customer_accounts') r), 'customer accounts include the email');
select pg_temp.ok((select count(*) from unnest(public.admin_data_export_areas()) a) >= 25, 'all areas listed');
select pg_temp.throws($$select * from public.admin_data_export('push_subscriptions')$$, 'invalid_request', 'only listed areas (no push keys, no rate limits)');

-- reset: needs a recent export by the same admin and the exact phrase
select pg_temp.throws(format($$select public.admin_reset_test_data(%L)$$, public.admin_reset_phrase()), 'invalid_request', 'refused without a recent export');
select public.admin_log_export('all', '{"sheets":29}');
select pg_temp.throws($$select public.admin_reset_test_data('RESET')$$, 'invalid_request', 'refused with the wrong phrase');
create temp table t_reset as select public.admin_reset_test_data(public.admin_reset_phrase()) as r;
reset role;

select pg_temp.ok((select (r ->> 'orders')::int >= 1 and (r ->> 'customer_accounts')::int >= 2 from t_reset), 'reports what was removed');
select pg_temp.ok(not exists (select 1 from public.orders) and not exists (select 1 from public.order_items) and not exists (select 1 from public.payment_submissions),
                  'orders and payments removed');
select pg_temp.ok(not exists (select 1 from public.printing_jobs) and not exists (select 1 from public.printing_files), 'printing jobs removed');
select pg_temp.ok(not exists (select 1 from public.customers) and not exists (select 1 from public.customer_accounts a where not exists (select 1 from public.profiles p where p.id = a.id)), 'customers removed (staff kept)');
select pg_temp.ok(not exists (select 1 from auth.users where id in (:customer, :customer2)), 'customer sign-in accounts removed');
select pg_temp.ok(not exists (select 1 from public.wallet_ledger) and not exists (select 1 from public.wallet_topups), 'wallet history removed');
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where not (event_type = 'admin_action' and payload ->> 'action' = 'data_reset')) and not exists (select 1 from public.security_events), 'queued messages and security events removed (only the Telegram notice about the reset remains)');
select pg_temp.ok((select products = (select count(*) from public.products) and categories = (select count(*) from public.categories)
                          and banks = (select count(*) from public.bank_accounts) and staff = (select count(*) from public.profiles)
                          and zones = (select count(*) from public.delivery_zones) from t_before), 'products, categories, banks, zones and staff kept');
select pg_temp.ok(exists (select 1 from auth.users where id = :super), 'staff sign-in accounts kept');
select pg_temp.ok((select stock = (select stock_quantity from public.products where id = :charger) from t_before), 'stock levels kept as they are');
select pg_temp.ok((select count(*) from public.audit_logs) = (select count(*) from public.audit_logs where action in ('audit_cleared', 'data_reset')), 'test activity cleared');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'data_reset' and actor_id = :super), 'the reset itself is recorded');
select pg_temp.throws($$delete from public.audit_logs where action = 'data_reset'$$, '%append-only%', 'the reset record cannot be deleted');
select pg_temp.ok(current_setting('app.data_reset', true) = 'off' and current_setting('app.audit_purge', true) = 'off', 'protections switched back on after the reset');
select pg_temp.ok(nextval('public.order_number_seq') = 10001, 'order numbers start again at ET-10001');
