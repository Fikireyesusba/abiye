-- 0065: virus-scan security events; a blocked upload makes the account an active (high-risk) alert.
\ir _helpers.sql
set role service_role;
select public.record_security_event('upload_blocked', 'customer@test.local', :customer, 'abcdef12', null, '{"where":"payment_receipt","found":"virus: EICAR-Test-File"}');
select public.record_security_event('scan_unavailable', 'customer2@test.local', :customer2, 'abcdef12', null, '{"where":"printing_file","problem":"scanner answered HTTP 503"}');
reset role;
select pg_temp.ok((select count(*) from public.security_events where kind in ('upload_blocked', 'scan_unavailable')) = 2, 'virus-scan events are recorded');
select pg_temp.ok(private.email_risk_24h('customer@test.local') >= 6, 'a blocked upload makes the account high-risk at once');
select pg_temp.ok(private.email_risk_24h('customer2@test.local') = 0, 'a scanner outage does not count against the customer');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'security_event' and payload ->> 'kind' = 'upload_blocked') = 1,
  'blocked upload → security Telegram alert');
select pg_temp.throws($$insert into public.security_events (kind) values ('something_else')$$, '%security_events_kind_check%', 'unknown event kinds are still refused');
rollback;
