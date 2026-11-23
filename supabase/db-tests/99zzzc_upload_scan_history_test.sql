-- 0066: scan history of customer uploads — written only by the server, read only by staff.
\ir _helpers.sql
set role service_role;
select public.record_upload_scan(:customer, 'topup_receipt', null, 'png', 2048, repeat('a', 64), 'clean', null, 850);
select public.record_upload_scan(:customer, 'payment_receipt', gen_random_uuid()::text, 'pdf', 4096, repeat('b', 64), 'blocked', 'virus: EICAR-Test-File', 900);
reset role;
select pg_temp.ok((select member_id from public.upload_scans where sha256 = repeat('a', 64)) = (select member_id::text from public.customer_accounts where id = :customer),
  'scan recorded with the customer''s User ID');
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.upload_scans) = 0, 'customers cannot read the scan history');
select pg_temp.throws($$select public.record_upload_scan(null, 'topup_receipt', null, 'png', 1, repeat('c', 64), 'clean')$$, '%permission denied%', 'customers cannot write scans');
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.upload_scans where sha256 in (repeat('a', 64), repeat('b', 64))) = 2, 'staff see the scan history');
select pg_temp.throws($$delete from public.upload_scans$$, '%permission denied%', 'nobody deletes scan history');
select pg_temp.throws($$update public.upload_scans set result = 'clean'$$, '%permission denied%', 'nobody edits scan history');
reset role;
set role service_role;
select pg_temp.throws($$select public.record_upload_scan(null, 'topup_receipt', null, 'png', 1, 'not-a-hash', 'clean')$$, '%upload_scans_sha256_check%', 'only real fingerprints');
reset role;
rollback;
