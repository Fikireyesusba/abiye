-- Security alerts can be cleared ("mark as reviewed"); they return only on new activity
\ir _helpers.sql

insert into public.security_events (kind, email, ip_hash, created_at)
select 'admin_login_failed', 'attacker@example.com', md5(g::text), now() - interval '2 hours' from generate_series(1, 4) g;

select pg_temp.login(:super);
select pg_temp.ok((select score >= 6 from public.admin_suspicious_emails(1) where email = 'attacker@example.com'), 'high-risk email listed (red badge)');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_mark_security_reviewed('email', array['attacker@example.com'])$$, 'forbidden', 'only Super Admin clears alerts');
reset role;
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_mark_security_reviewed('order', array['x@example.com'])$$, 'invalid_request', 'only emails or customers');
select pg_temp.ok(public.admin_mark_security_reviewed('email', array['Attacker@Example.com'], 'Known staff typo') = 1, 'marked as reviewed');
select pg_temp.ok(not exists (select 1 from public.admin_suspicious_emails(1) where email = 'attacker@example.com'), 'gone from the list and badge');
select pg_temp.ok((select note = 'Known staff typo' and reviewed_by_name is not null from public.admin_security_reviews() where subject = 'attacker@example.com'), 'review history with who and why');
reset role;
select pg_temp.ok((select count(*) from public.security_events where email = 'attacker@example.com') = 4, 'events are kept');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'security_reviewed'), 'review recorded in the Activity log');

-- a new attempt after the review brings it back
insert into public.security_events (kind, email, ip_hash, created_at) values ('admin_mfa_failed', 'attacker@example.com', md5('new'), now() + interval '1 second');
select pg_temp.login(:super);
select pg_temp.ok((select failed_mfa = 1 and failed_admin = 0 from public.admin_suspicious_emails(1) where email = 'attacker@example.com'), 'new activity after the review shows again (only the new part)');

-- customers
reset role;
select public.create_order_for_user(:customer, pg_temp.order_payload(k, jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))))
  from (values ('d5000000-0000-0000-0000-000000000001'::uuid), ('d5000000-0000-0000-0000-000000000002'::uuid), ('d5000000-0000-0000-0000-000000000003'::uuid)) v(k);
update public.orders set status = 'expired', created_at = now() - interval '1 day' where user_id = :customer;
select pg_temp.login(:super);
select pg_temp.ok(exists (select 1 from public.admin_suspicious_customers(30) where user_id = :customer), 'customer with unpaid orders listed');
select public.admin_mark_security_reviewed('customer', array[:customer::text]);
select pg_temp.ok(not exists (select 1 from public.admin_suspicious_customers(30) where user_id = :customer), 'reviewed customer cleared');
