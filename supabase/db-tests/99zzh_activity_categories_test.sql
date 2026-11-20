-- Activity log categories
\ir _helpers.sql
insert into public.audit_logs (actor_id, action, entity_type, entity_id) values
  (:super, 'order_status', 'order', 'o1'), (:super, 'payment_verified', 'payment_submission', 's1'), (:super, 'topup_verified', 'customer_account', 'c1'),
  (:super, 'customer_deactivated', 'customer_account', 'c2'), (:super, 'update', 'products', 'p1'), (:super, 'update', 'bank_accounts', 'b1'),
  (:super, 'email_blocked', 'security', 'x@example.com'), (:super, 'export_orders', 'export', null);
select pg_temp.ok(private.activity_category('topup_verified', 'customer_account') = 'payments', 'top-ups are payments (not customers)');
select pg_temp.ok(private.activity_category('update', 'bank_accounts') = 'staff', 'bank accounts under staff & settings');
select pg_temp.ok(private.activity_category('export_orders', 'export') = 'security', 'exports under security & data');
select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_activity_categories(30) where total > 0) >= 6, 'counts per category');
select pg_temp.ok((select bool_and(category = 'payments') and count(*) >= 2 from public.admin_activity_by_category('payments')), 'payments list only');
select pg_temp.ok((select count(*) from public.admin_activity_by_category(null)) >= 8, 'all categories');
select pg_temp.throws($$select * from public.admin_activity_by_category('nope')$$, 'invalid_request', 'unknown category refused');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select * from public.admin_activity_categories(30)$$, 'forbidden', 'managers cannot read the activity log');
reset role;
