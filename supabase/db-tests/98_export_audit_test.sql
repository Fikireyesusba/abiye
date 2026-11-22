-- Order export audit
\ir _helpers.sql
select pg_temp.login(:manager);
select public.admin_log_export('orders', '{"from":"2026-11-01","to":"2026-11-20","rows":12}');
select pg_temp.throws($$select public.admin_log_export('nonsense', '{}')$$, 'invalid_request', 'only known export kinds');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'export_orders' and actor_id = :manager and metadata ->> 'rows' = '12') = 1, 'export recorded with who and how many rows');
select pg_temp.login(:staff);
select pg_temp.throws($$select public.admin_log_export('orders', '{}')$$, 'forbidden', 'staff (assigned orders only) cannot export');
reset role;
rollback;
