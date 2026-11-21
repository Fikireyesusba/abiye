-- Manage services: a switched-off service is refused by the database
\ir _helpers.sql
create function pg_temp.services(p jsonb) returns void language sql as $$
  update public.website_settings set value = value || p where key = 'services' $$;
select pg_temp.ok(private.service_on('shop') and private.service_on('printing') and private.service_on('unknown'), 'everything on by default');

-- shop off: no product orders, no receipts for product orders
set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload('db000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
reset role;
select pg_temp.services('{"shop": false}');
set role service_role;
select pg_temp.throws(format($$select public.create_order_for_user(%L, %L)$$, :customer, pg_temp.order_payload('db000000-0000-0000-0000-000000000002', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1)))), 'service_unavailable', 'shop off: product orders refused');
select pg_temp.throws(format($$select public.submit_payment(%L)$$, jsonb_build_object('order_id', (select id from public.orders where idempotency_key = 'db000000-0000-0000-0000-000000000001'),
  'access_token_hash', pg_temp.hash('tok-db000000-0000-0000-0000-000000000001'),
  'receipt', jsonb_build_object('path', 'orders/db/r.png', 'mime', 'image/png', 'size', 10, 'sha256', repeat('d', 64)))), 'service_unavailable', 'shop off: receipt for a product order refused');
reset role;
select pg_temp.services('{"shop": true}');
set role service_role;
select public.submit_payment(jsonb_build_object('order_id', (select id from public.orders where idempotency_key = 'db000000-0000-0000-0000-000000000001'),
  'access_token_hash', pg_temp.hash('tok-db000000-0000-0000-0000-000000000001'),
  'receipt', jsonb_build_object('path', 'orders/db/r.png', 'mime', 'image/png', 'size', 10, 'sha256', repeat('d', 64))));
reset role;
select pg_temp.ok((select status = 'pending_verification' from public.orders where idempotency_key = 'db000000-0000-0000-0000-000000000001'), 'back on: works again');

-- printing off: no new jobs
select pg_temp.services('{"printing": false}');
select pg_temp.throws($$insert into public.printing_jobs (user_id, access_token_hash, customer_name, customer_phone, color_mode, paper_size, sides, copies)
  values ('cccccccc-0000-0000-0000-000000000001', repeat('e', 64), 'P Buyer', '+251911223344', 'bw', 'A4', 'single', 1)$$, 'service_unavailable', 'printing off: uploads refused');
select pg_temp.services('{"printing": true}');

-- wallet off: no top-ups
select pg_temp.services('{"wallet": false}');
select pg_temp.throws(format($$insert into public.wallet_topups (user_id, amount_etb, receipt_path, receipt_mime, receipt_size_bytes, receipt_sha256)
  values (%L, 100, %L, 'image/png', 100, %L)$$, :customer, 'topups/' || gen_random_uuid() || '/' || gen_random_uuid() || '.png', repeat('f', 64)),
  'service_unavailable', 'wallet off: top-ups refused');
select pg_temp.services('{"wallet": true}');

-- reviews off
select pg_temp.services('{"reviews": false}');
select pg_temp.throws(format($$insert into public.product_reviews (product_id, user_id, rating, display_name) values (%L, %L, 5, 'X')$$, :charger, :customer2),
  'service_unavailable', 'reviews off: new reviews refused');

-- visitors can read the switches (to show "temporarily unavailable")
set role anon;
select pg_temp.ok((select value ? 'printing' from public.website_settings where key = 'services'), 'switches are public');
reset role;
