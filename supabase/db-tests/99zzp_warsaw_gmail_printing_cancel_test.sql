-- 0046: Warsaw time, Gmail-only sign-ups, printing documents group, customers cancel unpaid orders
\ir _helpers.sql
-- Gmail only (production setting; the local seed adds test domains)
update public.website_settings set value = '{"domains": ["gmail.com"]}' where key = 'signup_email_domains';
select pg_temp.throws($$insert into auth.users (id, email) values (gen_random_uuid(), 'someone@yahoo.com')$$, '%email_domain_not_allowed%', 'non-Gmail sign-up refused');
insert into auth.users (id, email) values (gen_random_uuid(), 'New.Customer@Gmail.com');
select pg_temp.ok(exists (select 1 from auth.users where email = 'New.Customer@Gmail.com'), 'Gmail sign-up accepted (any letter case)');
set role anon;
select pg_temp.ok(public.signup_email_allowed('a@gmail.com') and not public.signup_email_allowed('a@outlook.com'), 'the website can check before signing up');
reset role;
update auth.users set email = 'still-works@example.com' where id = :customer;
select pg_temp.ok(true, 'existing accounts are not affected');

-- Warsaw days
select pg_temp.ok(position('Europe/Warsaw' in pg_get_functiondef('public.admin_dashboard_stats(integer)'::regprocedure)) > 0
  and position('Africa/Addis_Ababa' in pg_get_functiondef('public.admin_sales_report(date, date)'::regprocedure)) = 0, 'days counted in Warsaw time');

-- Printing documents: only once the payment is approved
delete from public.notifications_outbox;
insert into public.printing_jobs (id, user_id, access_token_hash, customer_name, customer_phone, color_mode, paper_size, sides, copies, page_count, total_etb, status)
values ('e1000000-0000-0000-0000-000000000001', :customer, repeat('a', 64), 'Print Buyer', '+251911223344', 'bw', 'A4', 'single', 2, 3, 30, 'payment_verification');
insert into public.printing_files (job_id, storage_path, original_name, mime_type, size_bytes, sha256, page_count) values
  ('e1000000-0000-0000-0000-000000000001', 'jobs/e1/a.pdf', 'thesis.pdf', 'application/pdf', 1000, repeat('b', 64), 2),
  ('e1000000-0000-0000-0000-000000000001', 'jobs/e1/b.pdf', 'cover.pdf', 'application/pdf', 500, repeat('c', 64), 1);
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where event_type = 'printing_document'), 'no documents before the payment is approved');
update public.printing_jobs set status = 'printing' where id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'printing_document' and attachment_bucket = 'printing-files') = 2,
  'payment approved: each document queued with its file');
select pg_temp.ok((select string_agg(payload ->> 'file_name', ',' order by payload ->> 'file_name') || ' ' || string_agg(payload ->> 'n', ',' order by payload ->> 'n')
                   || '/' || max(payload ->> 'of') from public.notifications_outbox where event_type = 'printing_document') = 'cover.pdf,thesis.pdf 1,2/2', 'with name and number');
select pg_temp.ok(private.telegram_group('printing_document') = 'printing', 'printing group');
update public.printing_jobs set status = 'ready' where id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'printing_document') = 2, 'sent once only');

-- Customer cancels before the payment is approved
set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload('d9000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 2))));
select public.create_order_for_user(:customer, pg_temp.order_payload('d9000000-0000-0000-0000-000000000002', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
select public.submit_payment(jsonb_build_object('order_id', (select id from public.orders where idempotency_key = 'd9000000-0000-0000-0000-000000000002'),
  'access_token_hash', pg_temp.hash('tok-d9000000-0000-0000-0000-000000000002'),
  'receipt', jsonb_build_object('path', 'orders/d9/r.png', 'mime', 'image/png', 'size', 10, 'sha256', repeat('9', 64))));
reset role;
select (select stock_quantity from public.products where id = :charger) as stock_before \gset
select pg_temp.login(:customer2);
select pg_temp.throws(format($$select public.customer_cancel_order(%L)$$, (select id from public.orders where idempotency_key = 'd9000000-0000-0000-0000-000000000001')),
  'not_found', 'cannot cancel someone else''s order');
reset role;
select pg_temp.login(:customer);
select public.customer_cancel_order((select id from public.orders where idempotency_key = 'd9000000-0000-0000-0000-000000000001'), 'Changed my mind');
select public.customer_cancel_order((select id from public.orders where idempotency_key = 'd9000000-0000-0000-0000-000000000002'));
reset role;
select pg_temp.ok((select count(*) from public.orders where idempotency_key::text like 'd9000000%' and status = 'cancelled') = 2, 'unpaid and waiting-for-approval orders cancelled');
select pg_temp.ok((select stock_quantity from public.products where id = :charger) = :stock_before + 3, 'stock released');
select pg_temp.ok((select status = 'rejected' and review_note like '%cancelled by the customer%' from public.payment_submissions
                   where order_id = (select id from public.orders where idempotency_key = 'd9000000-0000-0000-0000-000000000002')), 'waiting receipt closed (leaves the To verify list)');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'order_status' and metadata ->> 'by' = 'customer'), 'recorded');
-- after approval: no longer possible
set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload('d9000000-0000-0000-0000-000000000003', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
select public.submit_payment(jsonb_build_object('order_id', (select id from public.orders where idempotency_key = 'd9000000-0000-0000-0000-000000000003'),
  'access_token_hash', pg_temp.hash('tok-d9000000-0000-0000-0000-000000000003'),
  'receipt', jsonb_build_object('path', 'orders/d9/r3.png', 'mime', 'image/png', 'size', 10, 'sha256', repeat('8', 64))));
reset role;
select pg_temp.login(:super);
select public.admin_review_payment((select s.id from public.payment_submissions s join public.orders o on o.id = s.order_id where o.idempotency_key = 'd9000000-0000-0000-0000-000000000003'), 'verified');
reset role;
select pg_temp.login(:customer);
select pg_temp.throws(format($$select public.customer_cancel_order(%L)$$, (select id from public.orders where idempotency_key = 'd9000000-0000-0000-0000-000000000003')),
  'invalid_transition', 'approved orders cannot be cancelled by the customer');
reset role;
