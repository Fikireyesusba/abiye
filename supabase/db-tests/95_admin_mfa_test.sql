-- Two-step login: admin permissions need an aal2 session
\ir _helpers.sql

select pg_temp.login(:super, 'aal1');
select pg_temp.ok(public.my_admin_context() is null, 'password-only session gets no admin context');
select pg_temp.ok((public.my_staff_status() ->> 'staff')::boolean and not (public.my_staff_status() ->> 'mfa_verified')::boolean,
  'sign-in flow can still see it is a staff account needing the second step');
select pg_temp.throws($$select * from public.admin_customer_accounts()$$, 'forbidden', 'password-only session cannot call admin functions');
select pg_temp.ok((select count(*) from public.bank_accounts) = 0, 'password-only session cannot read bank accounts');
select pg_temp.ok((select count(*) from public.audit_logs) = 0, 'password-only session cannot read the audit log');
select pg_temp.throws($$insert into public.bank_accounts (bank_name, account_holder, account_number) values ('X', 'Hacker', '1000123456')$$,
  '%row-level security%', 'password-only session cannot change bank accounts');
reset role;

select pg_temp.login(:super);
select pg_temp.ok(public.my_admin_context() ->> 'role' = 'super_admin', 'after the second step the admin has full access');
select pg_temp.ok((public.my_staff_status() ->> 'mfa_verified')::boolean, 'status reports the second step');
select pg_temp.throws($$select public.admin_log_mfa_reset('aaaaaaaa-0000-0000-0000-000000000001')$$, 'cannot_modify_self', 'cannot reset own two-step login');
select public.admin_log_mfa_reset(:staff);
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'mfa_reset' and entity_id = :staff::text and actor_id = :super) = 1, 'reset is audited');

select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_log_mfa_reset('aaaaaaaa-0000-0000-0000-000000000003')$$, 'forbidden', 'managers cannot reset two-step login');
reset role;

-- customers are unaffected (no second step)
select pg_temp.login(:customer, 'aal1');
select pg_temp.ok(not (public.my_staff_status() ->> 'staff')::boolean, 'customers are not staff');
reset role;
rollback;
