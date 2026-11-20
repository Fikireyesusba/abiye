-- Security monitoring: events, blocked emails, suspicious lists, health
\ir _helpers.sql

set role service_role;
select public.record_security_event('admin_login_failed', 'Attacker@Evil.test', null, 'aaaa1111', 'curl', '{"code":"invalid_credentials"}');
select public.record_security_event('admin_login_failed', 'attacker@evil.test', null, 'bbbb2222', 'curl');
select public.record_security_event('admin_mfa_failed', 'super@test.local', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaa1111', 'Chrome');
select public.record_security_event('customer_login_failed', 'customer@test.local', null, 'cccc3333', 'Safari');
select public.record_cron_run('expire-orders', true, '{"expired":2}');
reset role;

select pg_temp.login(:customer);
select pg_temp.throws($$select * from public.security_events$$, '%permission denied%', 'customers cannot read security events');
select pg_temp.throws($$select public.record_security_event('admin_login_failed', 'x@y.z')$$, '%permission denied%', 'only the server records events');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select * from public.admin_suspicious_emails()$$, 'forbidden', 'managers cannot see the security page');
select pg_temp.throws($$select public.admin_block_email('a@b.co', 'spam')$$, 'forbidden', 'managers cannot block emails');
reset role;

select pg_temp.login(:super);
create temp table t_s as select * from public.admin_suspicious_emails(7);
select pg_temp.ok((select failed_admin = 2 and networks = 2 and not has_account and score >= 6 from t_s where email = 'attacker@evil.test'),
  'failed admin sign-ins grouped by the email used (lower-cased), with networks counted');
select pg_temp.ok((select email from t_s limit 1) = 'attacker@evil.test', 'highest risk first');
select pg_temp.ok((select is_staff from t_s where email = 'super@test.local'), 'two-step failures on a staff account are visible');
select pg_temp.ok((select count(*) from public.admin_security_events('admin_login_failed')) = 2, 'event log');
select pg_temp.ok((public.admin_system_health() #>> '{cron,expire-orders,ok}')::boolean, 'site health shows the scheduled job');
select pg_temp.throws($$select public.admin_block_email('staff@test.local', 'x reason')$$, 'cannot_manage_staff', 'staff emails are not blocked here');
select public.admin_block_email(' Attacker@Evil.test ', 'Brute-force on admin');
select public.admin_block_email('customer2@test.local', 'Fake receipts');
reset role;
select pg_temp.ok((select deactivated_at is not null and deactivation_reason like 'Blocked email:%' from public.customer_accounts where id = :customer2),
  'blocking an existing customer deactivates the account');

-- enforcement
set role service_role;
select pg_temp.ok(public.is_email_blocked('ATTACKER@evil.test'), 'blocked check is case-insensitive');
reset role;
select pg_temp.throws($$insert into auth.users (id, email) values (gen_random_uuid(), 'attacker@evil.test')$$, '%email_blocked%', 'blocked emails cannot sign up (even via the API)');
update public.customer_accounts set deactivated_at = null where id = :customer2; -- isolate the email rule
set role service_role;
select pg_temp.throws($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000002', pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))$$,
  'email_blocked', 'blocked emails cannot order');
reset role;
update public.customer_accounts set deactivated_at = now(), deactivation_reason = 'Blocked email: Fake receipts' where id = :customer2;

select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_blocked_emails()) = 2, 'blocked list');
select public.admin_unblock_email('customer2@test.local');
reset role;
select pg_temp.ok((select deactivated_at is null from public.customer_accounts where id = :customer2), 'unblocking reactivates an account deactivated by the block');
select pg_temp.ok((select count(*) from public.audit_logs where action in ('email_blocked', 'email_unblocked')) = 3, 'blocking is in the activity log');

-- suspicious customers
update auth.users set email_confirmed_at = now() where id = :customer;
set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)))) from generate_series(1, 3);
reset role;
update public.orders set status = 'expired' where user_id = :customer;
select pg_temp.login(:super);
select pg_temp.ok((select 'Many orders placed but never paid' = any(reasons) from public.admin_suspicious_customers(30) where user_id = :customer),
  'customer who keeps placing unpaid orders is flagged');
reset role;
set role service_role;
select pg_temp.ok(public.purge_security_events() = 0, 'recent events are kept (purge only after 180 days)');
reset role;
rollback;
