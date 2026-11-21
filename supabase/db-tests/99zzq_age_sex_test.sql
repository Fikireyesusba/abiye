-- Date of birth and sex: customers set them once (or at sign-up); staff change them
\ir _helpers.sql
insert into auth.users (id, email, raw_user_meta_data) values
  ('c7000000-0000-0000-0000-000000000001', 'dob@example.com', '{"full_name":"Dob Person","date_of_birth":"1995-04-12","sex":"female"}'),
  ('c7000000-0000-0000-0000-000000000002', 'baddob@example.com', '{"full_name":"Bad Dob","date_of_birth":"not a date","sex":"other"}');
select pg_temp.ok((select date_of_birth = '1995-04-12' and sex = 'female' from public.customer_accounts where id = 'c7000000-0000-0000-0000-000000000001'), 'saved from the sign-up form');
select pg_temp.ok((select date_of_birth is null and sex is null from public.customer_accounts where id = 'c7000000-0000-0000-0000-000000000002'), 'invalid values ignored (sign-up still works)');

update public.customer_accounts set date_of_birth = null, sex = null where id = :customer;
select pg_temp.login(:customer);
update public.customer_accounts set date_of_birth = '1990-01-02', sex = 'male' where id = :customer;
update public.customer_accounts set date_of_birth = '1980-01-01', sex = 'female' where id = :customer;
reset role;
select pg_temp.ok((select date_of_birth = '1990-01-02' and sex = 'male' from public.customer_accounts where id = :customer), 'set once by the customer, then locked');
select pg_temp.login(:customer2);
select pg_temp.throws(format($$update public.customer_accounts set date_of_birth = %L where id = %L$$, current_date - 30, :customer2), 'invalid_request', 'too young refused');
select pg_temp.throws(format($$update public.customer_accounts set sex = 'x' where id = %L$$, :customer2), '%customer_accounts_sex_check%', 'only female / male');
reset role;

select pg_temp.login(:super);
select public.admin_update_customer_details(:customer, 'Test Customer', null, null, '1991-05-05', 'female');
select pg_temp.ok((select date_of_birth = '1991-05-05' and sex = 'female' from public.customer_accounts where id = :customer), 'staff change them');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'profile_updated' and entity_id = :customer::text and after_data ->> 'sex' = 'female'), 'recorded');
select public.admin_update_staff_details(:staff, 'Staff Member', '+251911000333', '1988-08-08', 'male');
select pg_temp.ok((select date_of_birth = '1988-08-08' and sex = 'male' and phone = '+251911000333' from public.profiles where id = :staff), 'staff personal details saved');
select pg_temp.throws(format($$select public.admin_update_staff_details(%L, 'X', null, %L, null)$$, :staff, current_date - 100), 'invalid_request', 'staff age checked');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws(format($$select public.admin_update_staff_details(%L, 'X', null, null, null)$$, :staff), 'forbidden', 'only Super Admin edits staff details');
reset role;
