-- Admin view of registered customer accounts
\ir _helpers.sql
set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload('f0000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))));
reset role;

select pg_temp.login(:manager);
create temp table t_acc as select * from public.admin_customer_accounts(null, 500);
select pg_temp.ok((select count(*) from t_acc where email = 'customer2@test.local') = 1, 'accounts without orders are listed');
select pg_temp.ok((select order_count from t_acc where email = 'customer@test.local') = 1, 'order count per account');
select pg_temp.ok((select email_confirmed_at is null from t_acc where email = 'unconfirmed@test.local'), 'unconfirmed sign-ups are visible as unconfirmed');
select pg_temp.ok((select is_staff from t_acc where email = 'staff@test.local'), 'staff accounts are flagged');
select pg_temp.ok((select count(*) from public.admin_customer_accounts('customer2', 10)) = 1, 'search by email');
select pg_temp.ok((select count(*) from public.admin_customer_accounts('Test Customer', 10)) = 1, 'search by name');
select pg_temp.ok((select count(*) from public.admin_customer_accounts($$%' or 1=1 --$$, 10)) = 0, 'search input is data, not SQL');
select pg_temp.ok((select email from public.admin_customer_accounts(null, 1, 'cccccccc-0000-0000-0000-000000000002')) = 'customer2@test.local', 'lookup of a single account');
reset role;

select pg_temp.login(:staff);
select pg_temp.throws($$select * from public.admin_customer_accounts()$$, 'forbidden', 'staff without customers.view cannot list accounts');
reset role;
select pg_temp.login(:customer);
select pg_temp.throws($$select * from public.admin_customer_accounts()$$, 'forbidden', 'customers cannot list accounts');
reset role;
set role anon;
select pg_temp.throws($$select * from public.admin_customer_accounts()$$, '%permission denied%', 'anon cannot list accounts');
reset role;
rollback;
