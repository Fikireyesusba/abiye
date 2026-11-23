-- Orders group: approvals only by default; stock and receipts groups
\ir _helpers.sql
delete from public.website_settings where key = 'telegram_feed';
delete from public.notifications_outbox;

-- defaults: order progress off, approvals on
select private.enqueue_notification('order_placed', 'x:1', '{}');
select private.enqueue_notification('payment_verified', 'x:2', '{}');
select private.enqueue_notification('order_cancelled', 'x:3', '{}');
select private.enqueue_notification('new_order', 'x:4', '{}');
select private.enqueue_notification('payment_resubmitted', 'x:5', '{}');
select private.enqueue_notification('wallet_topup', 'x:6', '{}');
select private.enqueue_notification('printing_request', 'x:7', '{}');
select pg_temp.ok((select array_agg(event_type order by event_type) from public.notifications_outbox)
                  = array['payment_verified', 'wallet_topup'], 'defaults: approved payments and top-ups to verify (0059); order payments waiting and printing requests off');
delete from public.notifications_outbox;
insert into public.website_settings (key, value, is_public) values ('telegram_feed', '{"pending_payments": true}', false);
select private.enqueue_notification('new_order', 'x:4b', '{}');
select private.enqueue_notification('wallet_topup', 'x:6b', '{}');
select pg_temp.ok((select count(*) from public.notifications_outbox where dedupe_key in ('x:4b', 'x:6b')) = 2, 'waiting-for-approval alerts can be switched on');
select pg_temp.login(:super);
select public.admin_set_telegram_feed(true, true, false, true, false);
reset role;
select private.enqueue_notification('order_placed', 'x:8', '{}');
select private.enqueue_notification('printing_request', 'x:9', '{}');
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where dedupe_key = 'x:8') and not exists (select 1 from public.notifications_outbox where dedupe_key = 'x:9'),
                  'order steps never sent (0045); printing requests can be switched off');

-- routing
select pg_temp.ok(private.telegram_group('low_stock') = 'stock' and private.telegram_group('receipt_record') = 'receipts'
                  and private.telegram_group('new_order') = 'orders' and private.telegram_group('admin_action') = 'security', 'four groups');

-- receipts group gets the file on each decision
select public.create_order_for_user(:customer, pg_temp.order_payload('d7000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
set role service_role;
select public.submit_payment(jsonb_build_object('order_id', (select id from public.orders where idempotency_key = 'd7000000-0000-0000-0000-000000000001'),
  'access_token_hash', pg_temp.hash('tok-d7000000-0000-0000-0000-000000000001'), 'transaction_reference', 'FTRECTG1',
  'receipt', jsonb_build_object('path', 'orders/x/rec.png', 'mime', 'image/png', 'size', 100, 'sha256', repeat('e', 64))));
reset role;
select pg_temp.login(:manager);
select public.admin_review_payment((select id from public.payment_submissions where transaction_reference = 'FTRECTG1'), 'verified');
reset role;
select pg_temp.ok((select attachment_bucket = 'payment-receipts' and attachment_path = 'orders/x/rec.png' and payload ->> 'result' = 'verified'
                          and payload ->> 'decided_by' is not null and payload ->> 'reference' = 'FTRECTG1'
                     from public.notifications_outbox where event_type = 'receipt_record'), 'verified receipt file queued for the receipts group');
set role service_role;
create temp table t_r as select * from public.claim_telegram_groups(array['receipts'], 50);
create temp table t_o as select * from public.claim_telegram_groups(array['orders'], 50);
reset role;
select pg_temp.ok((select bool_and(event_type = 'receipt_record') and count(*) = 1 from t_r), 'receipts group claims receipts only');
select pg_temp.ok(not exists (select 1 from t_o where event_type = 'receipt_record'), 'orders group does not get receipt files');

-- stock: Telegram, no email
update public.products set stock_quantity = 20, low_stock_threshold = 5 where id = :charger;
update public.products set stock_quantity = 4 where id = :charger;
select pg_temp.ok(exists (select 1 from public.notifications_outbox where event_type = 'low_stock')
                  and not exists (select 1 from public.notifications_outbox where channel = 'email' and event_type like 'staff_%'), 'stock alert by Telegram, no email');

-- group tests
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_queue_group_test('stock')$$, 'forbidden', 'only Super Admin sends group tests');
reset role;
select pg_temp.login(:super);
select public.admin_queue_group_test('receipts');
select pg_temp.throws($$select public.admin_queue_group_test('nope')$$, 'invalid_request', 'known groups only');
reset role;
select pg_temp.ok(exists (select 1 from public.notifications_outbox where event_type = 'receipts_test'), 'receipts group test queued');
