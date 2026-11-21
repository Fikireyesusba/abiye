-- Super Admin: deactivate and delete (remove) staff
\ir _helpers.sql
-- Give the staff member some open work first (as the database owner).
update public.orders set assigned_to = :staff
 where id = (select id from public.orders where status not in ('completed', 'cancelled', 'expired') order by created_at limit 1);
select (select count(*) from public.orders where assigned_to = :staff) as open_before \gset

select pg_temp.login(:manager);
select pg_temp.throws(format($$select public.admin_remove_staff(%L)$$, :staff), 'forbidden', 'manager cannot delete staff');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_remove_staff(%L)$$, :staff2), 'forbidden', 'staff cannot delete staff');
reset role;

select pg_temp.login(:super);
select pg_temp.throws(format($$select public.admin_remove_staff(%L)$$, :super), 'cannot_modify_self', 'cannot delete yourself');
select pg_temp.throws(format($$select public.admin_remove_staff(%L)$$, :customer), 'not_found', 'a customer is not staff');

-- deactivate + reactivate keeps the role
select public.admin_set_staff_role(:staff2, 'staff', false);
select pg_temp.ok(not (select is_active from public.profiles where id = :staff2), 'deactivated');
select public.admin_set_staff_role(:staff2, 'staff', true);
select pg_temp.ok((select is_active from public.profiles where id = :staff2), 'reactivated');

select pg_temp.ok(public.admin_remove_staff(:staff) is not null, 'delete returns the name');
select pg_temp.ok((select not is_active and removed_at is not null and removed_by = :super from public.profiles where id = :staff), 'marked removed, no access');
select pg_temp.ok(not exists (select 1 from public.orders where assigned_to = :staff and status not in ('completed', 'cancelled', 'expired')), 'open orders unassigned');
select pg_temp.ok(exists (select 1 from public.audit_logs where entity_type = 'profiles' and entity_id = :staff::text and after_data ->> 'removed_at' is not null), 'recorded in the activity log');
select pg_temp.throws(format($$select public.admin_set_staff_role(%L, 'staff', true)$$, :staff), 'not_found', 'deleted staff cannot be switched back on');
select pg_temp.throws(format($$select public.admin_remove_staff(%L)$$, :staff), 'not_found', 'cannot delete twice');
reset role;

-- the deleted staff member has no admin access any more
select pg_temp.login(:staff);
select pg_temp.ok(not private.has_permission('orders.update_fulfillment'), 'deleted staff has no permissions');
reset role;
select pg_temp.throws(format($$update public.profiles set is_active = true where id = %L$$, :staff), '%profiles_removed_inactive%', 'a removed profile cannot be active');

-- never lose the last super admin
update public.profiles set role_id = (select id from public.admin_roles where key = 'super_admin') where id = :manager;
select pg_temp.login(:manager);
select public.admin_remove_staff(:super);
select pg_temp.ok((select removed_at is not null from public.profiles where id = :super), 'one super admin can delete another');
reset role;
