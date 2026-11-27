-- 0077: metrics for Grafana — totals only, server (service role) only.
\ir _helpers.sql
select pg_temp.ok(not has_function_privilege('anon', 'public.metrics_snapshot()', 'execute')
                  and not has_function_privilege('authenticated', 'public.metrics_snapshot()', 'execute')
                  and has_function_privilege('service_role', 'public.metrics_snapshot()', 'execute'),
  'only the server can read the metrics');
set role service_role;
select pg_temp.ok((select (m ? 'payments_pending') and (m ? 'deliveries') and (m ? 'cron_last_run_age_seconds') and m::text !~ '@' and m::text !~ '\+2519'
                   from (select public.metrics_snapshot() as m) x), 'metrics: totals, no emails or phone numbers');
reset role;
rollback;
