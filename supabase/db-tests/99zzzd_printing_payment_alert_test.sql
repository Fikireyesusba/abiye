-- 0067: a printing order's payment receipt is always announced in the orders & payments group (marked as
-- printing), even with the "pending payment alerts" switch off; product orders still follow the switch.
\ir _helpers.sql
update public.website_settings set value = value || '{"pending_payments": false}' where key = 'telegram_feed';

create function pg_temp.job67(p_id uuid, p_pages integer) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'access_token_hash', pg_temp.hash('job-' || p_id),
    'customer', jsonb_build_object('full_name', 'Print Customer', 'phone', '+251911223344'),
    'color_mode', 'bw', 'paper_size', 'A4', 'sides', 'single', 'copies', 2, 'fulfillment_method', 'pickup',
    'files', jsonb_build_array(jsonb_build_object(
      'path', 'jobs/' || p_id || '/' || gen_random_uuid() || '.pdf', 'original_name', 'doc.pdf',
      'mime', 'application/pdf', 'size', 1000, 'sha256', repeat('e', 64), 'page_count', p_pages))) $$;

set role service_role;
select public.create_printing_job_for_user(:customer, pg_temp.job67('c6700000-0000-0000-0000-000000000001', 5));
create temp table t_print as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'printing', 'printing_job_id', 'c6700000-0000-0000-0000-000000000001', 'access_token_hash', pg_temp.hash('job-c6700000-0000-0000-0000-000000000001'))), 'pickup')) as r;
create temp table t_prod as select public.create_order_for_user(:customer2, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')) as r;
reset role;

insert into public.notifications_outbox (event_type, dedupe_key, payload) values
  ('new_order', 'test67:print', jsonb_build_object('order_id', (select r ->> 'order_id' from t_print), 'order_number', (select r ->> 'order_number' from t_print))),
  ('new_order', 'test67:product', jsonb_build_object('order_id', (select r ->> 'order_id' from t_prod), 'order_number', (select r ->> 'order_number' from t_prod)));
select pg_temp.ok((select (payload ->> 'printing')::boolean from public.notifications_outbox where dedupe_key = 'test67:print'),
  'switch off: a printing order''s "payment to verify" alert is still sent, marked as printing');
select pg_temp.ok(private.telegram_group('new_order') = 'orders', '… to the orders & payments group');
select pg_temp.ok((select count(*) from public.notifications_outbox where dedupe_key = 'test67:product') = 0,
  'switch off: a product order''s alert is not sent (follows the switch)');
update public.website_settings set value = value || '{"pending_payments": true}' where key = 'telegram_feed';
insert into public.notifications_outbox (event_type, dedupe_key, payload)
  values ('new_order', 'test67:product2', jsonb_build_object('order_id', (select r ->> 'order_id' from t_prod)));
select pg_temp.ok((select count(*) from public.notifications_outbox where dedupe_key = 'test67:product2' and not payload ? 'printing') = 1,
  'switch on: product orders are announced too (not marked as printing)');
rollback;
