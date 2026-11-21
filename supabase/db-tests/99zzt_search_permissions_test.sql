-- Search with dates; permission sets; personal permissions
\ir _helpers.sql
-- security events by date and text
insert into public.security_events (kind, email, ip_hash, created_at) values
  ('customer_login_failed', 'old-one@example.com', md5('a'), now() - interval '10 days'),
  ('customer_login_failed', 'new-one@example.com', md5('b'), now());
reset role;
insert into public.notifications_outbox (event_type, dedupe_key, payload) values ('test_message', 'srch:1', '{"order_number":"ET-SEARCH1"}');
select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_security_events(null, null, 500, now() - interval '1 day', null, 'one@example')) = 1, 'events: date range + text');
select pg_temp.ok((select count(*) from public.admin_activity_by_category(null, null, 500, null, now() + interval '1 day', now() + interval '2 days')) = 0, 'activity: date range');
select pg_temp.ok((select count(*) from public.admin_notifications_search(now() - interval '1 hour', null, 'ET-SEARCH1')) = 1, 'notifications: date + text');
reset role;

-- permission sets
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_save_role(null, 'Cashier', null, array['orders.manage'])$$, 'forbidden', 'only Super Admin manages permission sets');
reset role;
select pg_temp.login(:super);
select public.admin_save_role(null, 'Cashier', 'Counter sales only', array['dashboard.view', 'orders.manage', 'orders.view_all']) as cashier \gset
select pg_temp.ok((select key from public.admin_roles where id = :cashier) = 'cashier', 'new set created with a key');
select pg_temp.throws(format($$select public.admin_save_role(%s::smallint, 'Cashier', null, array['staff.manage'])$$, :cashier), 'invalid_request', 'staff.manage stays with Super Admin');
select pg_temp.throws($$select public.admin_save_role((select id from public.admin_roles where key = 'super_admin'), 'Owner', null, array['orders.view_all'])$$, 'invalid_request', 'Super Admin set cannot be narrowed');
select pg_temp.throws(format($$select public.admin_save_role(%s::smallint, 'Cashier', null, array['no.such'])$$, :cashier), 'invalid_request', 'unknown permission refused');
select public.admin_set_staff_role(:staff, 'cashier', true);
reset role;
select pg_temp.login(:staff);
select pg_temp.ok(private.has_permission('orders.manage') and not private.has_permission('printing.view'), 'staff now has exactly the Cashier permissions');
select pg_temp.ok(public.my_admin_context() ->> 'role_name' = 'Cashier', 'context shows the set name');
reset role;
-- edit the built-in Manager set
select pg_temp.login(:super);
select public.admin_save_role((select id from public.admin_roles where key = 'manager'), 'Manager', null,
  (select array_agg(permission_key) || array['reviews.manage'] from public.role_permissions where role_id = (select id from public.admin_roles where key = 'manager')));
select pg_temp.throws(format($$select public.admin_delete_role(%s::smallint)$$, :cashier), 'invalid_request', 'a set still assigned cannot be deleted');
select pg_temp.throws($$select public.admin_delete_role((select id from public.admin_roles where key = 'staff'))$$, 'invalid_request', 'built-in sets cannot be deleted');
-- personal permissions
select public.admin_set_member_permissions(:staff, array['customers.view']);
reset role;
select pg_temp.login(:staff);
select pg_temp.ok(private.has_permission('customers.view') and (public.my_admin_context() -> 'permissions') ? 'customers.view', 'personal permission added on top of the set');
reset role;
select pg_temp.login(:super);
select public.admin_set_member_permissions(:staff, '{}');
select pg_temp.throws(format($$select public.admin_set_member_permissions(%L, array['staff.manage'])$$, :staff), 'invalid_request', 'staff.manage cannot be given personally');
select pg_temp.throws(format($$select public.admin_set_member_permissions(%L, array['orders.view_all'])$$, :super), 'cannot_modify_self', 'not for yourself');
select public.admin_set_staff_role(:staff, 'staff', true);
select public.admin_delete_role(:cashier::smallint);
reset role;
select pg_temp.login(:staff);
select pg_temp.ok(not private.has_permission('customers.view'), 'personal permission removed');
reset role;
select pg_temp.ok(exists (select 1 from public.audit_logs where entity_type = 'profile_permissions'), 'personal permissions recorded in the activity log');
