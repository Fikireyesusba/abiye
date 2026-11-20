-- Saved customer details; activity export and clearing
\ir _helpers.sql

-- customer saves delivery details (own row only)
select pg_temp.login(:customer);
update public.customer_accounts set default_zone_id = '40000000-0000-0000-0000-000000000001', default_address = 'Bole, House 7' where id = :customer;
select pg_temp.throws($$update public.customer_accounts set default_address = 'x' where id = 'cccccccc-0000-0000-0000-000000000001'$$, '%check constraint%', 'address must be 3–300 characters');
update public.customer_accounts set default_address = 'Hacked' where id = :customer2;
reset role;
select pg_temp.ok((select default_address = 'Bole, House 7' and default_zone_id is not null from public.customer_accounts where id = :customer), 'customer saved delivery city and address');
select pg_temp.ok((select default_address is null from public.customer_accounts where id = :customer2), 'cannot change someone else''s details');
select pg_temp.ok((select after_data ->> 'address' = 'Bole, House 7' and after_data ? 'delivery_city' from public.audit_logs
                     where action = 'profile_updated' and entity_id = :customer::text order by id desc limit 1), 'change recorded on the customer timeline');

-- export
insert into public.audit_logs (action, entity_type, created_at) values ('old_thing', 'test', now() - interval '60 days'), ('recent_thing', 'test', now() - interval '5 days');
select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_activity_export(now() - interval '90 days', now() + interval '1 minute', 'test')) = 2, 'export by period and area');
select public.admin_log_export('activity', '{"rows":2}');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select * from public.admin_activity_export(now() - interval '1 day', now())$$, 'forbidden', 'managers cannot export the activity log');
select pg_temp.throws($$select public.admin_clear_audit_logs(now() - interval '60 days')$$, 'forbidden', 'managers cannot clear it');
reset role;

-- clearing
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_clear_audit_logs(now() - interval '10 days')$$, 'invalid_request', 'the last 30 days are always kept');
select pg_temp.ok(public.admin_clear_audit_logs(now() - interval '30 days') >= 1, 'old entries cleared');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'old_thing') = 0 and (select count(*) from public.audit_logs where action = 'recent_thing') = 1,
  'only entries before the date were removed');
select pg_temp.ok((select count(*) from public.audit_logs where action = 'audit_cleared' and actor_id = :super) = 1, 'the clearing itself is recorded');
select pg_temp.throws($$delete from public.audit_logs where action = 'recent_thing'$$, '%append-only%', 'the log stays append-only otherwise');
alter table public.audit_logs disable trigger audit_logs_immutable; -- test setup only
update public.audit_logs set created_at = now() - interval '90 days' where action = 'audit_cleared';
alter table public.audit_logs enable trigger audit_logs_immutable;
select pg_temp.login(:super);
select public.admin_clear_audit_logs(now() - interval '31 days');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'audit_cleared') = 2, 'clearing records are never removed');
rollback;
