-- Two Telegram groups; full order / printing progress for the orders group
\ir _helpers.sql
-- Message contents of order steps / copies are still built; the 0045 filter (payments only) is lifted for this file.
alter table public.notifications_outbox disable trigger notifications_outbox_telegram_filter;
-- These tests check the order-progress Telegram messages: switch them on (default is off).
insert into public.website_settings (key, value, is_public) values ('telegram_feed', '{"order_progress": true, "notifications": true}', false)
  on conflict (key) do update set value = public.website_settings.value || excluded.value;
delete from public.notifications_outbox;

-- order placed (checked at commit; here forced with SET CONSTRAINTS)
select public.create_order_for_user(:customer, pg_temp.order_payload('d6000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 2))));
set constraints all immediate;
select pg_temp.ok((select payload ->> 'order_number' is not null and jsonb_array_length(payload -> 'items') = 1 and payload ->> 'payment_due_at' is not null
                     from public.notifications_outbox where event_type = 'order_placed'), 'order placed → orders group with items and deadline');
set constraints all deferred;

-- every later step until collection
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where idempotency_key = 'd6000000-0000-0000-0000-000000000001';
update public.orders set status = 'processing' where idempotency_key = 'd6000000-0000-0000-0000-000000000001';
update public.orders set status = 'ready_for_pickup' where idempotency_key = 'd6000000-0000-0000-0000-000000000001';
update public.orders set status = 'completed' where idempotency_key = 'd6000000-0000-0000-0000-000000000001';
select pg_temp.ok((select array_agg(payload ->> 'to' order by id) from public.notifications_outbox where event_type = 'order_status')
                  = array['processing', 'ready_for_pickup', 'completed'], 'processing, ready and collected are reported');

-- printing job steps
set role service_role;
select public.create_printing_job_for_user(:customer, pg_temp.job_payload('c6000000-0000-0000-0000-000000000001', null)); -- needs a manual quote
reset role;
update public.printing_jobs set status = 'awaiting_payment', total_etb = 40 where id = 'c6000000-0000-0000-0000-000000000001';
update public.printing_jobs set status = 'printing' where id = 'c6000000-0000-0000-0000-000000000001';
update public.printing_jobs set status = 'ready' where id = 'c6000000-0000-0000-0000-000000000001';
update public.printing_jobs set status = 'completed' where id = 'c6000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'printing_status') = 4, 'printing quote, printing, ready, collected reported');

-- the two groups are claimed separately
insert into public.security_events (kind, email, ip_hash) values ('admin_login_failed', 'x@example.com', 'abcdabcdabcdabcd');
set role service_role;
create temp table t_orders as select * from public.claim_telegram(false, 50);
create temp table t_sec as select * from public.claim_telegram(true, 50);
reset role;
select pg_temp.ok((select count(*) from t_orders) >= 8 and not exists (select 1 from t_orders where event_type in ('security_event', 'security_alert', 'admin_action')),
                  'orders group gets orders, payments and printing only');
select pg_temp.ok((select count(*) from t_sec) >= 1 and not exists (select 1 from t_sec where event_type not in ('security_event', 'security_alert', 'admin_action')),
                  'security group gets security only');
set role authenticated;
select pg_temp.throws($$select * from public.claim_telegram(true, 10)$$, '%permission denied%', 'only the server can claim messages');
reset role;
