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

-- 0079: token made by the Super Admin (fingerprint only)
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_set_metrics_token(repeat('a', 64))$$, 'forbidden', 'only the Super Admin creates the Grafana token');
reset role;
select pg_temp.login(:super);
select public.admin_set_metrics_token(encode(sha256(convert_to('grafana-test-token-0123456789-abcdefghij', 'UTF8')), 'hex'));
reset role;
set role anon;
select pg_temp.ok((select public.metrics_snapshot_for('grafana-test-token-0123456789-abcdefghij') ? 'payments_pending'), 'the right token reads the totals');
select pg_temp.throws($$select public.metrics_snapshot_for('grafana-test-token-0123456789-WRONGWRONG')$$, 'forbidden', 'a wrong token is refused');
reset role;

-- 0078: with "monitoring alerts from Grafana" on, the website's own copies are not queued; events still are.
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_set_grafana_alerts(true)$$, 'forbidden', 'only settings.manage can switch it');
reset role;
select pg_temp.login(:super);
select public.admin_set_grafana_alerts(true);
reset role;
select private.enqueue_notification('low_stock', 'test-low-' || gen_random_uuid(), '{"name":"x"}');
select private.enqueue_notification('delivery_alert', 'test-late-' || gen_random_uuid(), '{"kind":"delivery_late"}');
select private.enqueue_notification('security_event', 'test-sec-' || gen_random_uuid(), '{"kind":"admin_login_failed"}');
select pg_temp.ok((select count(*) from public.notifications_outbox where dedupe_key like 'test-low-%' or dedupe_key like 'test-late-%') = 0
                  and (select count(*) from public.notifications_outbox where dedupe_key like 'test-sec-%') = 1,
  'Grafana on: no website copies of monitoring alerts; events still sent');
select pg_temp.login(:super);
select public.admin_set_grafana_alerts(false);
reset role;
select private.enqueue_notification('low_stock', 'test-low2-' || gen_random_uuid(), '{"name":"x"}');
select pg_temp.ok((select count(*) from public.notifications_outbox where dedupe_key like 'test-low2-%') = 1, 'Grafana off: the website sends them again');
rollback;
