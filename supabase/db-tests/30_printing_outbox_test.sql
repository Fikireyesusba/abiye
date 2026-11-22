-- Printing jobs, notification outbox worker, rate limiting, storage policies
\ir _helpers.sql
-- These tests check the order-progress Telegram messages: switch them on (default is off).
insert into public.website_settings (key, value, is_public) values ('telegram_feed', '{"order_progress": true, "notifications": true}', false)
  on conflict (key) do update set value = public.website_settings.value || excluded.value;
set role service_role;

-- ----------------------------------------------------------- printing pricing
select pg_temp.ok((public.quote_printing('bw', 'A4', 'single', 10, 3) ->> 'total_etb')::numeric = 90,
  'B/W A4 single: 10 pages × 3 copies × 3.00 = 90');
select pg_temp.ok((public.quote_printing('color', 'A4', 'double', 7, 2) ->> 'total_etb')::numeric = 140,
  'Color A4 double: 7 × 2 × 10.00 = 140');
select pg_temp.ok(public.quote_printing('color', 'A3', 'double', 5, 1) is null, 'no active rule → no automatic price');
select pg_temp.ok(public.quote_printing('bw', 'A4', 'single', null, 1) is null, 'unknown page count → no automatic price');
update public.website_settings set value = jsonb_set(value, '{service_charge_etb}', '15') where key = 'printing';
select pg_temp.ok((public.quote_printing('bw', 'A4', 'single', 10, 3) ->> 'total_etb')::numeric = 105,
  'service charge added from admin settings');
update public.website_settings set value = jsonb_set(value, '{service_charge_etb}', '0') where key = 'printing';

-- ----------------------------------------------------------- printing jobs

select public.create_printing_job_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.job_payload('c0000000-0000-0000-0000-000000000001', 20));
select pg_temp.ok((select status = 'awaiting_payment' and total_etb = 120 and page_count_source = 'auto'
                   from public.printing_jobs where id = 'c0000000-0000-0000-0000-000000000001'),
  'PDF with counted pages is priced automatically (20 × 2 × 3 = 120)');
select pg_temp.ok((select array_agg(to_status::text order by id) from public.printing_job_history
                   where job_id = 'c0000000-0000-0000-0000-000000000001') = array['submitted', 'awaiting_payment'],
  'printing job history: submitted → awaiting payment');
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where dedupe_key = 'printing_job:c0000000-0000-0000-0000-000000000001'),
  'no staff alert for a new printing request (only once its payment is submitted)');

select public.create_printing_job_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.job_payload('c0000000-0000-0000-0000-000000000002', null));
select pg_temp.ok((select status = 'awaiting_quote' and total_etb is null
                   from public.printing_jobs where id = 'c0000000-0000-0000-0000-000000000002'),
  'document without page count requires admin quote');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(), jsonb_build_array(
  jsonb_build_object('type', 'printing', 'printing_job_id', 'c0000000-0000-0000-0000-000000000002',
                     'access_token_hash', pg_temp.hash('job-c0000000-0000-0000-0000-000000000002'))), 'pickup')),
  'printing_job_not_payable', 'unquoted printing job cannot be paid');
select pg_temp.throws(format($$select public.create_printing_job_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, jsonb_set(pg_temp.job_payload('c0000000-0000-0000-0000-000000000003', 3),
  '{files,0,path}', '"jobs/someone-else/doc.pdf"')), 'invalid_files', 'files must live under the job''s own folder');
reset role;

select pg_temp.login(:staff);
select public.admin_quote_printing_job('c0000000-0000-0000-0000-000000000002', 15, null, 'Counted manually');
select pg_temp.ok((select status = 'awaiting_payment' and total_etb = 90 and page_count_source = 'admin'
                   from public.printing_jobs where id = 'c0000000-0000-0000-0000-000000000002'), 'staff quote prices the job');
reset role;
select pg_temp.login(:staff);
update public.printing_price_rules set price_per_page_etb = 0.5;
reset role;
select pg_temp.ok((select min(price_per_page_etb) from public.printing_price_rules) = 2.5, 'staff cannot change printing prices');

set role service_role;
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(), jsonb_build_array(
  jsonb_build_object('type', 'printing', 'printing_job_id', 'c0000000-0000-0000-0000-000000000001',
                     'access_token_hash', pg_temp.hash('stolen'))), 'pickup')),
  'printing_job_not_found', 'cannot pay for someone else''s printing job');
select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload('b1000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'printing', 'printing_job_id', 'c0000000-0000-0000-0000-000000000001',
                     'access_token_hash', pg_temp.hash('job-c0000000-0000-0000-0000-000000000001')),
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1)), 'pickup'));
select pg_temp.ok((select total_etb from public.orders where idempotency_key = 'b1000000-0000-0000-0000-000000000001') = 970,
  'mixed cart: printing 120 + charger 850 = 970');
select public.submit_payment(jsonb_build_object(
  'order_id', (select id from public.orders where idempotency_key = 'b1000000-0000-0000-0000-000000000001'),
  'access_token_hash', pg_temp.hash('tok-b1000000-0000-0000-0000-000000000001'),
  'receipt', jsonb_build_object('path', 'orders/p/r.pdf', 'mime', 'application/pdf', 'size', 5000, 'sha256', repeat('e', 64))));
select pg_temp.ok((select status from public.printing_jobs where id = 'c0000000-0000-0000-0000-000000000001') = 'payment_verification',
  'printing job moves to Payment Verification with its order');
reset role;

select pg_temp.login(:super);
select public.admin_review_payment((select s.id from public.payment_submissions s join public.orders o on o.id = s.order_id
                                     where o.idempotency_key = 'b1000000-0000-0000-0000-000000000001'), 'verified');
select pg_temp.ok((select status from public.printing_jobs where id = 'c0000000-0000-0000-0000-000000000001') = 'printing',
  'verified payment sends job to Printing');
select public.admin_update_printing_status('c0000000-0000-0000-0000-000000000001', 'ready', 'On shelf B');
select public.admin_update_printing_status('c0000000-0000-0000-0000-000000000001', 'completed');
select pg_temp.throws($$select public.admin_update_printing_status('c0000000-0000-0000-0000-000000000001', 'printing')$$,
  'invalid_transition', 'completed job cannot go backwards');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'payment_verified'), 'payment decision audit-logged');
reset role;
set role service_role;
update public.printing_jobs set files_delete_after = now() - interval '1 day' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from public.printing_files_due_for_deletion(100) where job_id = 'c0000000-0000-0000-0000-000000000001') = 0,
  'files are kept while their copy for the printing Telegram group is still waiting to be sent');
reset role;
update public.notifications_outbox set status = 'sent', sent_at = now() where dedupe_key like 'printing_document:%';
set role service_role;
select pg_temp.ok((select count(*) from public.printing_files_due_for_deletion(100) where job_id = 'c0000000-0000-0000-0000-000000000001') = 1,
  'completed job''s files become due after the retention period');
select pg_temp.ok(public.mark_printing_files_deleted(array(select file_id from public.printing_files_due_for_deletion(100))) >= 1, 'files marked deleted');
reset role;
update public.notifications_outbox set status = 'pending', sent_at = null where dedupe_key like 'printing_document:%';
set role service_role;
select pg_temp.ok((select files_deleted_at is not null from public.printing_jobs where id = 'c0000000-0000-0000-0000-000000000001'),
  'job records that all its files are gone');
select pg_temp.ok((select count(*) from public.printing_files_due_for_deletion(100)) = 0, 'nothing due twice');
reset role;
set role anon;
select pg_temp.throws($$select public.printing_files_due_for_deletion()$$, '%permission denied%', 'anon cannot list files due for deletion');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws($$select public.mark_printing_files_deleted(array[gen_random_uuid()])$$, '%permission denied%', 'staff cannot call the retention worker');
reset role;
select pg_temp.login(:super);
reset role;

-- ----------------------------------------------------------- file retention
set role service_role;
select public.create_printing_job_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.job_payload('c0000000-0000-0000-0000-000000000009', 4));
update public.printing_jobs set files_delete_after = now() - interval '1 day'
 where id in ('c0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000001');
select pg_temp.ok((select array_agg(job_id::text) from public.printing_files_due_for_deletion(100)) = array['c0000000-0000-0000-0000-000000000009'],
  'retention: overdue idle job due; completed+overdue job due only once not in production');

set role service_role;
create temp table t_claim as select * from public.claim_notifications(50);
grant select on t_claim to authenticated;
select pg_temp.ok((select count(*) from t_claim) = (select count(*) from public.notifications_outbox where channel = 'telegram'),
  'worker claims all due notifications');
select pg_temp.ok((select count(*) from public.claim_notifications(50)) = 0, 'claimed rows are locked from other workers');
select public.complete_notification((select min(id) from t_claim), true);
select public.complete_notification((select max(id) from t_claim), false, 'Telegram 502 Bad Gateway');
select pg_temp.ok((select status = 'sent' and sent_at is not null from public.notifications_outbox where id = (select min(id) from t_claim)),
  'successful send marked sent');
select pg_temp.ok((select status = 'failed' and next_attempt_at > now() and last_error like '%502%'
                   from public.notifications_outbox where id = (select max(id) from t_claim)),
  'Telegram failure scheduled for retry with backoff (order data unaffected)');
update public.notifications_outbox set attempts = max_attempts, status = 'processing' where id = (select max(id) from t_claim);
select public.complete_notification((select max(id) from t_claim), false, 'still down');
select pg_temp.ok((select status from public.notifications_outbox where id = (select max(id) from t_claim)) = 'dead',
  'notification marked dead after max attempts');
select public.complete_notification((select min(id) from t_claim), false, 'late duplicate callback');
select pg_temp.ok((select status from public.notifications_outbox where id = (select min(id) from t_claim)) = 'sent',
  'sent notification cannot be re-opened by a stale worker');

-- ----------------------------------------------------------- admin notification view
reset role;
select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_notifications(100)) > 0, 'super admin can view the notification queue');
select public.admin_retry_notification((select max(id) from t_claim));
select pg_temp.throws(format($$select public.admin_retry_notification(%s)$$, (select min(id) from t_claim)), 'invalid_transition',
  'sent messages cannot be re-queued (no duplicate sends)');
select public.admin_queue_test_notification();
reset role;
select pg_temp.ok((select status = 'pending' and attempts = 0 from public.notifications_outbox where id = (select max(id) from t_claim)),
  'retry re-queues a dead message with fresh attempts');
select pg_temp.ok(exists (select 1 from public.notifications_outbox where event_type = 'test_message'), 'test message queued');
select pg_temp.login(:manager);
select pg_temp.throws($$select * from public.admin_notifications()$$, 'forbidden', 'manager cannot view notification queue');
select pg_temp.throws($$select public.admin_queue_test_notification()$$, 'forbidden', 'manager cannot send test messages');
reset role;
set role service_role;

-- ----------------------------------------------------------- rate limiting
select pg_temp.ok(public.check_rate_limit('checkout:ip:1.2.3.4', 3, 60), 'rate limit hit 1 allowed');
select public.check_rate_limit('checkout:ip:1.2.3.4', 3, 60);
select public.check_rate_limit('checkout:ip:1.2.3.4', 3, 60);
select pg_temp.ok(not public.check_rate_limit('checkout:ip:1.2.3.4', 3, 60), 'rate limit blocks 4th hit in window');
select pg_temp.ok(public.check_rate_limit('checkout:ip:5.6.7.8', 3, 60), 'rate limit is per key');
reset role;

-- ----------------------------------------------------------- storage policies
insert into storage.objects (bucket_id, name) values
  ('payment-receipts', 'orders/o1/r1.jpg'), ('printing-files', 'jobs/c1/doc.pdf'), ('product-images', 'p/1.webp');
set role anon;
select pg_temp.ok((select count(*) from storage.objects) = 0, 'anon cannot list any storage objects');
reset role;
select pg_temp.login(:staff);
select pg_temp.ok((select array_agg(bucket_id) from storage.objects) = array['printing-files'],
  'staff can read printing files but not payment receipts');
select pg_temp.throws($$insert into storage.objects (bucket_id, name) values ('product-images', 'evil.webp')$$,
  '%row-level security%', 'staff cannot upload product images');
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'payment-receipts') = 1, 'payment reviewers can read receipts');
insert into storage.objects (bucket_id, name) values ('product-images', 'p/2.webp');
select pg_temp.ok(true, 'product managers can upload product images');
select pg_temp.throws($$insert into storage.objects (bucket_id, name) values ('payment-receipts', 'forged.jpg')$$,
  '%row-level security%', 'nobody uploads receipts except the server');
reset role;

rollback;
