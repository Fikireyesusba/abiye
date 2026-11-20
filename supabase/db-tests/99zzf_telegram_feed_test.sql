-- Telegram activity feed: security events, alerts, admin actions, notification copies; switches
\ir _helpers.sql
-- These tests check the order-progress Telegram messages: switch them on (default is off).
insert into public.website_settings (key, value, is_public) values ('telegram_feed', '{"order_progress": true, "notifications": true}', false)
  on conflict (key) do update set value = public.website_settings.value || excluded.value;
delete from public.notifications_outbox;

-- security events (bursts within 5 minutes become one message with a count)
insert into public.security_events (kind, email, ip_hash, user_agent) select 'admin_login_failed', 'intruder@example.com', 'abcdef1234567890', 'curl/8' from generate_series(1, 3);
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'security_event') = 1, 'burst → one Telegram message');
select pg_temp.ok((select (payload ->> 'repeats')::int = 3 and payload ->> 'email' = 'intruder@example.com' and payload ->> 'device' = 'curl/8'
                     from public.notifications_outbox where event_type = 'security_event'), 'with the count, email and device');
update public.notifications_outbox set status = 'sent' where event_type = 'security_event';
insert into public.security_events (kind, email, ip_hash, user_agent) select 'admin_login_failed', 'intruder@example.com', 'abcdef1234567890', 'curl/8' from generate_series(1, 2);
select pg_temp.ok((select (payload ->> 'repeats')::int from public.notifications_outbox where event_type = 'security_event' and status = 'pending') = 2
                  and (select count(*) from public.notifications_outbox where event_type = 'security_event') = 2, 'repeats after the first message collect in one follow-up');
insert into public.security_events (kind, email, ip_hash) select 'admin_login_success', 'owner@example.com', 'abcdef1234567890' from generate_series(1, 2);
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'security_event' and payload ->> 'kind' = 'admin_login_success') = 2, 'every admin sign-in reported on its own');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'security_alert' and payload ->> 'email' = 'intruder@example.com') = 1,
                  '🚨 alert when the email becomes high-risk');
insert into public.security_events (kind, email, ip_hash) values ('admin_mfa_failed', 'intruder@example.com', 'ffff0000ffff0000');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'security_alert') = 1, 'alert only once per day per email');
insert into public.security_reviews (subject_type, subject, reviewed_at) values ('email', 'calm@example.com', now() + interval '1 hour');
insert into public.security_events (kind, email, ip_hash) select 'admin_login_failed', 'calm@example.com', md5(g::text) from generate_series(1, 4) g;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where event_type = 'security_alert' and payload ->> 'email' = 'calm@example.com'),
                  'no alert for reviewed activity');

-- admin actions: sensitive ones only
select pg_temp.login(:super);
select public.admin_set_telegram_feed(true, true, true);
reset role;
insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata) values (:super, 'email_blocked', 'security', 'bad@example.com', '{"reason":"spam"}');
insert into public.audit_logs (actor_id, action, entity_type, entity_id) values (:super, 'order_status', 'order', 'x');
select pg_temp.ok((select payload ->> 'actor' is not null and payload -> 'metadata' ->> 'reason' = 'spam' from public.notifications_outbox
                    where event_type = 'admin_action' and payload ->> 'action' = 'email_blocked'), 'blocking an email is reported with who and why');
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where event_type = 'admin_action' and payload ->> 'action' = 'order_status'), 'routine order work is not repeated');

-- notification copies once sent / failed
insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, recipient_user_id) values
  ('email', 'customer_order_confirmed', 'feedtest:1', '{"order_number":"ET-1"}', :customer),
  ('push', 'customer_order_confirmed', 'feedtest:2', '{"order_number":"ET-1"}', :customer);
update public.notifications_outbox set status = 'sent', sent_at = now() where dedupe_key = 'feedtest:1';
update public.notifications_outbox set status = 'dead', last_error = 'HTTP 410 gone' where dedupe_key = 'feedtest:2';
select pg_temp.ok((select payload ->> 'status' = 'sent' and payload ->> 'channel' = 'email' and payload ->> 'order_number' = 'ET-1' and payload ->> 'to' is not null
                     from public.notifications_outbox where event_type = 'notification_copy' and payload ->> 'channel' = 'email'), 'copy of a sent customer email');
select pg_temp.ok((select payload ->> 'error' = 'HTTP 410 gone' from public.notifications_outbox where event_type = 'notification_copy' and payload ->> 'channel' = 'push'),
                  'copy of a failed phone notification with the error');
update public.notifications_outbox set status = 'sent' where event_type = 'notification_copy';
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'notification_copy') = 2, 'Telegram messages are never copied again (no loop)');

-- switches
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_set_telegram_feed(false, false, false)$$, 'forbidden', 'only Super Admin changes the feed');
reset role;
select pg_temp.login(:super);
select public.admin_set_telegram_feed(false, false, false);
select pg_temp.ok(public.admin_telegram_feed() = '{"admin": false, "security": false, "notifications": false, "order_progress": false, "printing_requests": true}'::jsonb, 'switches saved');
reset role;
delete from public.notifications_outbox;
insert into public.security_events (kind, email, ip_hash) values ('customer_login_failed', 'quiet@example.com', '1234123412341234');
insert into public.audit_logs (actor_id, action, entity_type, entity_id) values (:super, 'email_blocked', 'security', 'x@example.com');
select pg_temp.ok(not exists (select 1 from public.notifications_outbox), 'nothing sent when switched off');

-- stale feed messages are dropped
select pg_temp.login(:super);
select public.admin_set_telegram_feed(true, true, true);
reset role;
insert into public.security_events (kind, email, ip_hash) values ('rate_limited', 'old@example.com', '9999999999999999');
update public.notifications_outbox set created_at = now() - interval '3 days' where event_type = 'security_event';
select pg_temp.ok(public.purge_stale_telegram_feed() = 1, 'feed messages never sent within 2 days are dropped');
