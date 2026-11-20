-- Printing documents due on pickup; payment receipts archived by email on decision
\ir _helpers.sql

-- ---- (1) picked up → files due for deletion
set role service_role;
select public.create_printing_job_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.job_payload('c9000000-0000-0000-0000-000000000001', 4));
reset role;
update public.printing_jobs set files_delete_after = now() + interval '30 days' where id = 'c9000000-0000-0000-0000-000000000001';
select pg_temp.ok(not exists (select 1 from public.printing_files_due_for_deletion(1000) where job_id = 'c9000000-0000-0000-0000-000000000001'),
                  'files kept while the job is open');
update public.printing_jobs set status = 'ready' where id = 'c9000000-0000-0000-0000-000000000001';
select pg_temp.ok(not exists (select 1 from public.printing_files_due_for_deletion(1000) where job_id = 'c9000000-0000-0000-0000-000000000001'),
                  'files kept while waiting for pickup');
update public.printing_jobs set status = 'completed' where id = 'c9000000-0000-0000-0000-000000000001';
select pg_temp.ok((select files_delete_after <= now() from public.printing_jobs where id = 'c9000000-0000-0000-0000-000000000001'), 'picked up → due now');
select pg_temp.ok(exists (select 1 from public.printing_files_due_for_deletion(1000) where job_id = 'c9000000-0000-0000-0000-000000000001'),
                  'the daily clean-up picks the files up');
select pg_temp.login(:manager);
select pg_temp.ok(public.admin_mark_printing_files_deleted('c9000000-0000-0000-0000-000000000001') = 1, 'files marked deleted after removal');
reset role;
select pg_temp.ok((select files_deleted_at is not null from public.printing_jobs where id = 'c9000000-0000-0000-0000-000000000001'), 'job shows files deleted');
select pg_temp.ok((select count(*) from public.printing_jobs where id = 'c9000000-0000-0000-0000-000000000001') = 1, 'the job record is kept');

-- ---- (2) receipt archive
create function pg_temp.paid_order(p_key uuid, p_ref text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload(p_key, jsonb_build_array(
    jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1))));
  select id into v_id from public.orders where idempotency_key = p_key;
  perform public.submit_payment(jsonb_build_object('order_id', v_id, 'access_token_hash', pg_temp.hash('tok-' || p_key),
    'transaction_reference', p_ref, 'receipt', jsonb_build_object('path', 'orders/' || v_id || '/r.png', 'mime', 'image/png', 'size', 100,
    'sha256', encode(sha256(p_ref::bytea), 'hex'))));
  return (select id from public.payment_submissions where order_id = v_id);
end $$;
create temp table t_s as select pg_temp.paid_order('e9000000-0000-0000-0000-000000000001', 'FTARCH001') as before_setup,
                                pg_temp.paid_order('e9000000-0000-0000-0000-000000000002', 'FTARCH002') as s1,
                                pg_temp.paid_order('e9000000-0000-0000-0000-000000000003', 'FTARCH003') as s2;
grant select on t_s to authenticated;

-- not configured: nothing queued
select pg_temp.login(:manager);
select public.admin_review_payment((select before_setup from t_s), 'verified');
reset role;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where channel = 'archive'), 'nothing archived before an address is set');

-- only Super Admin sets the address; validated; private
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_set_receipt_archive('x@example.com')$$, 'forbidden', 'managers cannot change the archive address');
reset role;
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_set_receipt_archive('not-an-email')$$, 'invalid_request', 'address must be an email');
select public.admin_set_receipt_archive('  Receipts@Example.com ');
reset role;
select pg_temp.ok((select value ->> 'email' = 'receipts@example.com' and not is_public from public.website_settings where key = 'receipt_archive'), 'address saved, not public');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'receipt_archive_set'), 'address change recorded');
set role anon;
select pg_temp.ok(not exists (select 1 from public.website_settings where key = 'receipt_archive'), 'visitors cannot see the address');
reset role;
select pg_temp.login(:manager);
select pg_temp.ok(not exists (select 1 from public.website_settings where key = 'receipt_archive'), 'managers cannot read it either');
select pg_temp.throws($$select public.receipt_archive_email()$$, '%permission denied%', 'only the server reads the address');

-- decisions are archived with the receipt attached
select public.admin_review_payment((select s1 from t_s), 'verified');
select public.admin_review_payment((select s2 from t_s), 'rejected', 'Not in our bank statement');
reset role;
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'archive') = 2, 'one archive email per decision');
select pg_temp.ok((select attachment_bucket = 'payment-receipts' and attachment_path like 'orders/%/r.png' and payload ->> 'result' = 'verified'
                     and payload ->> 'reference' = 'FTARCH002' and payload ->> 'decided_by' is not null and recipient_user_id is null
                   from public.notifications_outbox where dedupe_key = 'archive:payment:' || (select s1 from t_s) || ':verified'), 'verified receipt attached with details');
select pg_temp.ok((select payload ->> 'reason' = 'Not in our bank statement' from public.notifications_outbox
                    where dedupe_key = 'archive:payment:' || (select s2 from t_s) || ':rejected'), 'rejection reason included');

-- top-ups
set role service_role;
create temp table t_top as select (public.submit_wallet_topup(:customer, jsonb_build_object('amount_etb', '400', 'transaction_reference', 'FTTOPARCH1',
  'receipt', jsonb_build_object('path', 'topups/' || :customer || '/' || gen_random_uuid() || '.png', 'mime', 'image/png', 'size', 100,
  'sha256', encode(sha256('toparch'::bytea), 'hex')))) ->> 'topup_id')::uuid as id;
reset role;
grant select on t_top to authenticated;
select pg_temp.login(:manager);
select public.admin_review_topup((select id from t_top), 'verified');
reset role;
select pg_temp.ok((select payload ->> 'kind' = 'wallet_topup' and attachment_path like 'topups/%' from public.notifications_outbox
                    where dedupe_key = 'archive:topup:' || (select id from t_top) || ':verified'), 'top-up receipt archived');

-- past receipts
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_archive_past_receipts(now() - interval '1 day', now())$$, 'forbidden', 'managers cannot send past receipts');
reset role;
select pg_temp.login(:super);
select pg_temp.ok(public.admin_archive_past_receipts(now() - interval '1 day', now() + interval '1 minute') >= 1, 'past receipts queued (the one decided before setup)');
select pg_temp.ok(public.admin_archive_past_receipts(now() - interval '1 day', now() + interval '1 minute') = 0, 'never sent twice');
select pg_temp.ok((public.admin_receipt_archive_status() ->> 'waiting')::int >= 4 and public.admin_receipt_archive_status() ->> 'email' = 'receipts@example.com', 'status overview');
select public.admin_set_receipt_archive('');
select pg_temp.throws($$select public.admin_archive_past_receipts(now() - interval '1 day', now())$$, 'invalid_request', 'needs an address');
reset role;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where channel = 'archive' and payload ? 'access_token_hash'), 'no secrets in archive emails');
