-- Export audit: Excel downloads are for the Super Admin only (0061)
\ir _helpers.sql
select pg_temp.login(:super);
select public.admin_log_export('orders', '{"from":"2026-11-01","to":"2026-11-20","rows":12}');
select pg_temp.throws($$select public.admin_log_export('nonsense', '{}')$$, 'invalid_request', 'only known export kinds');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'export_orders' and actor_id = :super and metadata ->> 'rows' = '12') = 1, 'export recorded with who and how many rows');
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_log_export('orders', '{}')$$, 'forbidden', 'managers cannot download Excel (Super Admin only)');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws($$select public.admin_log_export('orders', '{}')$$, 'forbidden', 'staff cannot export');
reset role;
select pg_temp.login(:super, 'aal1');
select pg_temp.throws($$select public.admin_log_export('orders', '{}')$$, 'forbidden', 'not without the two-step code');
reset role;
rollback;
