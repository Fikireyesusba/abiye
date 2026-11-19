-- Customer accounts: ordering requires a confirmed account; customers see only their own orders
\ir _helpers.sql

select pg_temp.ok((select full_name from public.customer_accounts where id = :customer) = 'Test Customer',
  'sign-up creates a customer account with the name from sign-up');
select pg_temp.ok((select accepted_terms_at is not null from public.customer_accounts where id = :customer), 'terms acceptance recorded at sign-up');
select pg_temp.ok((select count(*) from public.profiles where id = :customer) = 0, 'signing up never creates an admin profile');

set role service_role;
select pg_temp.throws(format($$select public.create_order(%L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)))),
  '%permission denied%', 'server cannot bypass the account check by calling create_order directly');
select pg_temp.throws(format($$select public.create_order_for_user(null, %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)))),
  'login_required', 'no account → order refused');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000003', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)))),
  'login_required', 'unconfirmed email → order refused');
select pg_temp.throws(format($$select public.create_order_for_user(gen_random_uuid(), %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)))),
  'login_required', 'unknown user id → order refused');

select public.create_order_for_user(:customer, pg_temp.order_payload('e0000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))));
select public.create_order_for_user(:customer2, pg_temp.order_payload('e0000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000010','quantity',2)), 'pickup', '+251722111222'));
select pg_temp.ok((select user_id from public.orders where idempotency_key = 'e0000000-0000-0000-0000-000000000001') = 'cccccccc-0000-0000-0000-000000000001',
  'order is linked to the account that placed it');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000002', %L)$$,
  pg_temp.order_payload('e0000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)))),
  'idempotency_conflict', 'another account cannot replay (hijack) someone else''s checkout');
select pg_temp.throws($$insert into public.orders (access_token_hash, tracking_code_hash, idempotency_key, customer_id, customer_name, customer_phone,
  fulfillment_method, subtotal_etb, total_etb, bank_snapshot, payment_due_at)
  select repeat('a',64), repeat('b',64), gen_random_uuid(), id, 'x', phone, 'pickup', 1, 1, '{}', now() from public.customers limit 1$$,
  'login_required', 'even a direct insert without a user is refused');
select public.create_printing_job_for_user(:customer, pg_temp.job_payload('c0000000-0000-0000-0000-0000000000aa', 2));
select pg_temp.throws(format($$select public.create_printing_job(%L)$$, pg_temp.job_payload(gen_random_uuid(), 2)), '%permission denied%',
  'printing jobs also require the account wrapper');
reset role;

-- Customer reads only their own data
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.orders) = 1, 'customer sees exactly their own order');
select pg_temp.ok((select count(*) from public.order_items) = 1, 'customer sees only their own order items');
select pg_temp.ok((select count(*) from public.order_status_history) = 1, 'customer sees only their own order history');
select pg_temp.ok((select count(*) from public.printing_jobs) = 1, 'customer sees only their own printing jobs');
select pg_temp.ok((select count(*) from public.customer_accounts) = 1, 'customer sees only their own account');
select pg_temp.ok((select count(*) from public.payment_submissions) = 0 and (select count(*) from public.customers) = 0,
  'customer sees no payment receipts or customer directory');
update public.customer_accounts set phone = '+251911999888', full_name = 'Renamed' where id = :customer;
select pg_temp.ok((select phone from public.customer_accounts where id = :customer) = '+251911999888', 'customer can update own name/phone');
update public.customer_accounts set full_name = 'Hacked' where id = :customer2;
reset role;
select pg_temp.ok((select coalesce(full_name, '') from public.customer_accounts where id = :customer2) <> 'Hacked', 'customer cannot edit another account');
select pg_temp.login(:customer);
select pg_temp.throws($$update public.customer_accounts set accepted_terms_at = null$$, '%permission denied%', 'customer cannot alter terms acceptance');
select pg_temp.throws($$update public.orders set total_etb = 1$$, '%permission denied%', 'customer cannot modify orders');
select pg_temp.ok(public.my_admin_context() is null, 'customer has no admin access');
select pg_temp.throws($$select public.admin_dashboard_stats()$$, 'forbidden', 'customer cannot read admin stats');
reset role;

set role anon;
select pg_temp.ok((select value ? 'terms' from public.website_settings where key = 'legal'), 'terms & privacy are public settings');
select pg_temp.throws($$select * from public.customer_accounts$$, '%permission denied%', 'anon cannot read customer accounts');
reset role;
rollback;
