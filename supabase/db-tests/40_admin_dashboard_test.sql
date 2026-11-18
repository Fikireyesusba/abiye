-- Dashboard aggregates respect permissions
\ir _helpers.sql
set role service_role;
select public.create_order(pg_temp.order_payload('d0000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 2))));
select public.create_order(pg_temp.order_payload('d0000000-0000-0000-0000-000000000002', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1)), 'pickup', '+251722000111'));
select public.submit_payment(jsonb_build_object('order_id', (select id from public.orders where idempotency_key = 'd0000000-0000-0000-0000-000000000001'),
  'access_token_hash', pg_temp.hash('tok-d0000000-0000-0000-0000-000000000001'),
  'receipt', jsonb_build_object('path', 'orders/d/r.png', 'mime', 'image/png', 'size', 10, 'sha256', repeat('f', 64))));
reset role;

select pg_temp.login(:super);
select public.admin_review_payment((select id from public.payment_submissions limit 1), 'verified');
create temp table t_super as select public.admin_dashboard_stats(7) as s;
select pg_temp.ok((select (s->>'orders_total')::int from t_super) = 2, 'super admin sees all orders');
select pg_temp.ok((select (s->>'revenue_verified_total')::numeric from t_super) = 1850, 'super admin sees verified revenue (2×850 + 150)');
select pg_temp.ok((select jsonb_array_length(s->'daily') from t_super) = 7, 'daily series has one row per day');
select pg_temp.ok((select (s->'daily'->6->>'orders')::int from t_super) = 2, 'today''s orders counted');
select pg_temp.ok((select (s->>'awaiting_processing')::int from t_super) = 1, 'verified order awaits processing');
select pg_temp.ok((select (s->>'out_of_stock')::int from t_super) = 1, 'out-of-stock products counted');
select public.admin_assign_order((select id from public.orders where idempotency_key = 'd0000000-0000-0000-0000-000000000002'),
  'aaaaaaaa-0000-0000-0000-000000000003');
reset role;

select pg_temp.login(:manager);
create temp table t_mgr as select public.admin_dashboard_stats(7) as s;
select pg_temp.ok((select s->'revenue_verified_total' = 'null'::jsonb from t_mgr), 'manager does not see revenue');
select pg_temp.ok((select (s->>'pending_payments') is not null from t_mgr), 'manager sees pending payments');
reset role;

select pg_temp.login(:staff);
create temp table t_staff as select public.admin_dashboard_stats(7) as s;
select pg_temp.ok((select (s->>'orders_total')::int from t_staff) = 1, 'staff count only assigned orders');
select pg_temp.ok((select s->'pending_payments' = 'null'::jsonb and s->'products_active' = 'null'::jsonb from t_staff),
  'staff see no payment or catalog figures');
reset role;

select pg_temp.login(:outsider);
select pg_temp.throws($$select public.admin_dashboard_stats()$$, 'forbidden', 'non-staff cannot read dashboard stats');
reset role;
set role anon;
select pg_temp.throws($$select public.admin_dashboard_stats()$$, '%permission denied%', 'anon cannot call dashboard stats');
reset role;
-- Staff profile creation
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000009', 'new-staff@test.local');
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_create_staff_profile('aaaaaaaa-0000-0000-0000-000000000009', 'New', 'staff')$$,
  'forbidden', 'manager cannot grant admin access');
reset role;
select pg_temp.login(:super);
select public.admin_create_staff_profile('aaaaaaaa-0000-0000-0000-000000000009', 'New Staff', 'staff');
select pg_temp.ok((select created_by from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000009') = 'aaaaaaaa-0000-0000-0000-000000000001',
  'super admin creates staff profile; inviter recorded');
select pg_temp.ok(exists (select 1 from public.audit_logs where entity_type = 'profiles' and entity_id = 'aaaaaaaa-0000-0000-0000-000000000009'
  and actor_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'granting access is audit-logged with the actor');
select pg_temp.throws($$select public.admin_create_staff_profile('aaaaaaaa-0000-0000-0000-000000000009', 'Again', 'manager')$$,
  'invalid_request', 'cannot overwrite an existing profile (no silent role change)');
reset role;
rollback;
