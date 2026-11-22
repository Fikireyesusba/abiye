-- Member ID: 6 random letters/digits for every account (customers and staff), unique, never changeable
\ir _helpers.sql
select pg_temp.ok((select count(*) from auth.users u where not exists (select 1 from public.customer_accounts a where a.id = u.id and a.member_id is not null)) = 0,
  'every account (customer and staff) has a member ID');
select pg_temp.ok((select bool_and(member_id ~ '^[1-9][0-9]{5}$') from public.customer_accounts), 'User ID: 6 digits, numbers only');
select pg_temp.ok((select count(distinct member_id) = count(*) from public.customer_accounts), 'member IDs are unique');
select pg_temp.ok((select member_id from public.customer_accounts where id = :staff) is not null, 'staff have one too');

-- a new sign-up gets one automatically
insert into auth.users (id, email, raw_user_meta_data) values ('dddddddd-0000-0000-0000-0000000000a1', 'newbie@gmail.com', '{"full_name":"New Person"}');
select pg_temp.ok((select member_id ~ '^[1-9][0-9]{5}$' from public.customer_accounts where id = 'dddddddd-0000-0000-0000-0000000000a1'), 'new account gets a member ID');
create temp table t_mid as select member_id from public.customer_accounts where id = :customer;
grant select on t_mid to authenticated;

-- the customer cannot change it
select pg_temp.login(:customer);
select pg_temp.throws($$update public.customer_accounts set member_id = '123456' where id = auth.uid()$$, '%permission denied%', 'customer cannot change their member ID');
select pg_temp.ok((select member_id from public.customer_accounts where id = auth.uid()) = (select member_id from t_mid), 'customer can read their own member ID');
reset role;
update public.customer_accounts set member_id = '123456' where id = :customer;
select pg_temp.ok((select member_id from public.customer_accounts where id = :customer) = (select member_id from t_mid), 'member ID never changes, even for the database owner');

-- staff search customers by it
select pg_temp.login(:manager);
select pg_temp.ok((select email from public.admin_customer_accounts((select member_id from t_mid), 5)) = 'customer@test.local', 'search customers by User ID');
select pg_temp.ok((select member_id from public.admin_customer_accounts(null, 1, :customer)) = (select member_id from t_mid), 'member ID in the customer list');
reset role;
rollback;
