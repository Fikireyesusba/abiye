-- Staff are not listed under Customers
\ir _helpers.sql
select pg_temp.login(:super);
select pg_temp.ok(not exists (select 1 from public.admin_customer_accounts(null, 500) a join public.profiles p on p.id = a.id), 'no staff in the customer list');
select pg_temp.ok(exists (select 1 from public.admin_customer_accounts(null, 500) where id = :customer), 'customers are listed');
select pg_temp.ok(not exists (select 1 from public.admin_customer_accounts(null, 1, :manager)), 'a staff id returns nothing');
select pg_temp.ok(public.admin_is_staff_account(:manager) and not public.admin_is_staff_account(:customer), 'staff check for the redirect');
select pg_temp.ok(not exists (select 1 from public.admin_customer_accounts('aaaaaaaa', 500)), 'staff not found by search either');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_is_staff_account(%L)$$, :manager), 'forbidden', 'needs customers.view');
reset role;
