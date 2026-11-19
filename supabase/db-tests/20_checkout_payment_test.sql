-- Checkout, payment verification, inventory and order state-machine tests
\ir _helpers.sql
set role service_role;

-- ----------------------------------------------------------- order creation
-- A malicious client adds its own "price" fields: they must be ignored.
select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload('b0000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :perfume, 'quantity', 2, 'price', 1, 'unit_price_etb', 1),
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
create temp table t_o1 as select * from public.orders where idempotency_key = 'b0000000-0000-0000-0000-000000000001';
grant select on t_o1 to authenticated;
select pg_temp.ok((select subtotal_etb from t_o1) = 2850 * 2 + 850, 'subtotal uses DB sale price, ignores client prices');
select pg_temp.ok((select delivery_fee_etb from t_o1) = 150, 'delivery fee comes from the delivery zone');
select pg_temp.ok((select total_etb from t_o1) = 6700, 'total = subtotal + delivery');
select pg_temp.ok((select order_number from t_o1) ~ '^ET-[0-9]{5,}$', 'human-readable order number generated');
select pg_temp.ok((select status = 'awaiting_payment' and payment_status = 'unpaid' from t_o1), 'new order awaits payment');
select pg_temp.ok((select bank_snapshot ->> 'account_number' from t_o1) = '1000000000000', 'bank details snapshotted on order');
select pg_temp.ok((select stock_quantity from public.products where id = :perfume) = 13, 'stock reserved (15 → 13)');
select pg_temp.ok((select count(*) from public.inventory_movements where order_id = (select id from t_o1)) = 2,
  'inventory movements linked to order');
select pg_temp.ok((select count(*) from public.order_items where order_id = (select id from t_o1)) = 2, 'order items stored');
select pg_temp.ok((select unit_price_etb from public.order_items where order_id = (select id from t_o1) and product_id = :perfume) = 2850,
  'order item keeps price snapshot');
select pg_temp.ok((select count(*) from public.order_status_history where order_id = (select id from t_o1)) = 1,
  'order history started');
select pg_temp.ok((select order_count from public.customers where phone = '+251911223344') = 1, 'guest customer recorded');

-- Price change after ordering must not alter historical order
update public.products set sale_price_etb = 2000 where id = :perfume;
select pg_temp.ok((select line_total_etb from public.order_items where order_id = (select id from t_o1) and product_id = :perfume) = 5700,
  'later price changes do not affect existing orders');
update public.products set sale_price_etb = 2850 where id = :perfume;

-- Idempotent replay (double-click / network retry)
select pg_temp.ok((public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload('b0000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :perfume, 'quantity', 2)))) ->> 'replayed')::boolean,
  'retrying the same checkout returns the existing order');
select pg_temp.ok((select stock_quantity from public.products where id = :perfume) = 13, 'replay does not reserve stock twice');
select pg_temp.ok((select count(*) from public.orders) = 1, 'replay does not create a second order');

-- Validation
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000005','quantity',1)))),
  'out_of_stock', 'cannot buy out-of-stock product');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000006','quantity',6)))),
  'out_of_stock', 'cannot buy more than available stock');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000011','quantity',1)))),
  'product_unavailable', 'cannot buy draft product');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',-3)))),
  'invalid_cart', 'negative quantity rejected');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',0)))),
  'invalid_cart', 'zero quantity rejected');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(), '[]'::jsonb)),
  'invalid_cart', 'empty cart rejected');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)),
  'delivery', '0911223344')), 'invalid_phone', 'non-normalized phone rejected');
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$,
  jsonb_set(pg_temp.order_payload(gen_random_uuid(), jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))),
            '{fulfillment,delivery_zone_id}', '"40000000-0000-0000-0000-00000000dead"')),
  'invalid_delivery_zone', 'unknown delivery zone rejected');
select pg_temp.ok((select stock_quantity from public.products where id = :charger) = 79, 'failed checkouts reserved nothing');

-- Pickup: no delivery fee, no address stored
select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload('b0000000-0000-0000-0000-000000000002', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 2)), 'pickup', '+251722334455'));
select pg_temp.ok((select delivery_fee_etb = 0 and address_line is null and total_etb = 1700 from public.orders
                    where idempotency_key = 'b0000000-0000-0000-0000-000000000002'), 'pickup orders have no delivery fee');

-- Oversell protection: last units
select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload('b0000000-0000-0000-0000-000000000003', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000003', 'quantity', 3))));
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000003','quantity',1)))),
  'out_of_stock', 'second buyer of the last unit is refused');

-- ----------------------------------------------------------- payment evidence
create temp table t_receipt as select jsonb_build_object('path', 'orders/o1/r1.jpg', 'mime', 'image/jpeg', 'size', 120000,
  'original_name', 'receipt.jpg', 'sha256', repeat('a', 64)) as r;
grant select on t_receipt to service_role;
select pg_temp.throws(format($$select public.submit_payment(%L)$$, jsonb_build_object('order_id', (select id from t_o1),
  'access_token_hash', pg_temp.hash('wrong'), 'receipt', (select r from t_receipt))),
  'order_not_found', 'wrong access token cannot submit payment');
select public.submit_payment(jsonb_build_object('order_id', (select id from t_o1),
  'access_token_hash', pg_temp.hash('tok-b0000000-0000-0000-0000-000000000001'),
  'transaction_reference', 'FT2611ABC123', 'receipt', (select r from t_receipt)));
select pg_temp.ok((select status = 'pending_verification' and payment_status = 'pending_verification'
                   from public.orders where id = (select id from t_o1)), 'order becomes Pending Verification');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'new_order') = 1,
  'Telegram notification queued in outbox');
select pg_temp.ok((select payload ->> 'transaction_reference' = 'FT2611ABC123' and attachment_bucket = 'payment-receipts'
                   and jsonb_array_length(payload -> 'items') = 2
                   from public.notifications_outbox where event_type = 'new_order'), 'notification has items, reference & receipt');
-- Retry of the same upload
select pg_temp.ok((public.submit_payment(jsonb_build_object('order_id', (select id from t_o1),
  'access_token_hash', pg_temp.hash('tok-b0000000-0000-0000-0000-000000000001'),
  'receipt', (select r from t_receipt))) ->> 'replayed')::boolean, 'resubmitting the same receipt is idempotent');
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'telegram') = 1, 'no duplicate notification on retry');
select pg_temp.ok((select payment_status from public.orders where id = (select id from t_o1)) <> 'verified',
  'a screenshot alone never marks an order as paid');
reset role;

-- ----------------------------------------------------------- admin review
select pg_temp.login(:manager);
create temp table t_sub as select id from public.payment_submissions where order_id = (select id from t_o1);
grant select on t_sub to service_role;
select pg_temp.throws(format($$select public.admin_review_payment(%L, 'rejected')$$, (select id from t_sub)),
  'note_required', 'rejection requires a reason');
select public.admin_review_payment((select id from t_sub), 'rejected', 'Amount not found in bank statement');
select pg_temp.ok((select status = 'payment_rejected' and payment_status = 'rejected' from public.orders where id = (select id from t_o1)),
  'rejected payment moves order to Payment Rejected');
select pg_temp.throws(format($$select public.admin_review_payment(%L, 'verified')$$, (select id from t_sub)),
  'already_reviewed', 'a submission cannot be reviewed twice');
reset role;

set role service_role;
select public.submit_payment(jsonb_build_object('order_id', (select id from t_o1),
  'access_token_hash', pg_temp.hash('tok-b0000000-0000-0000-0000-000000000001'), 'transaction_reference', 'FT2611ABC123',
  'receipt', jsonb_build_object('path', 'orders/o1/r2.png', 'mime', 'image/png', 'size', 90000, 'sha256', repeat('b', 64))));
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'payment_resubmitted') = 1,
  'resubmission triggers a distinct notification');
select pg_temp.ok((select (payload ->> 'reference_seen_before')::boolean from public.notifications_outbox where event_type = 'payment_resubmitted'),
  'reused transaction reference is flagged for the reviewer');
reset role;

select pg_temp.login(:manager);
select public.admin_review_payment((select id from public.payment_submissions where order_id = (select id from t_o1) and status = 'pending'),
  'verified', 'Matched CBE statement');
select pg_temp.ok((select status = 'confirmed' and payment_status = 'verified' and payment_verified_by = 'aaaaaaaa-0000-0000-0000-000000000002'
                   from public.orders where id = (select id from t_o1)), 'verified payment confirms order and records verifier');
select pg_temp.ok((select reviewed_by is not null and reviewed_at is not null from public.payment_submissions
                   where order_id = (select id from t_o1) and status = 'verified'), 'reviewer and time recorded on submission');

-- ----------------------------------------------------------- fulfillment state machine
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'completed')$$, (select id from t_o1)),
  'invalid_transition', 'cannot skip fulfillment steps');
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'ready_for_pickup')$$, (select id from t_o1)),
  'invalid_transition', 'delivery orders cannot become ready-for-pickup') ;
select public.admin_assign_order((select id from t_o1), 'aaaaaaaa-0000-0000-0000-000000000003');
reset role;

-- Staff: only assigned orders, only fulfillment statuses
select pg_temp.login(:staff);
select pg_temp.ok((select count(*) from public.orders) = 1, 'staff see only their assigned order');
select pg_temp.ok((select count(*) from public.order_items) = 2, 'staff see items of their assigned order only');
select pg_temp.ok((select count(*) from public.payment_submissions) = 0, 'staff cannot see payment receipts');
select public.admin_update_order_status((select id from public.orders limit 1), 'processing', 'Packing');
select public.admin_update_order_status((select id from public.orders limit 1), 'out_for_delivery');
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'cancelled', 'x')$$,
  (select id from public.orders limit 1)), 'invalid_transition', 'cannot cancel an order already out for delivery');
insert into public.order_notes (order_id, body) select id, 'Customer asked for evening delivery' from public.orders limit 1;
select pg_temp.ok((select count(*) from public.order_notes) = 1, 'staff can add internal notes to assigned order');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'cancelled', 'x')$$,
  (select id from public.orders where idempotency_key = 'b0000000-0000-0000-0000-000000000002')),
  'not_found', 'staff cannot touch unassigned orders');
reset role;

-- ----------------------------------------------------------- cancellation & expiry release stock
select pg_temp.login(:manager);
select pg_temp.ok((select stock_quantity from public.products where id = :charger) = 77, 'charger stock before cancel = 77');
select pg_temp.throws(format($$select public.admin_update_order_status(%L, 'cancelled')$$,
  (select id from public.orders where idempotency_key = 'b0000000-0000-0000-0000-000000000002')),
  'note_required', 'cancellation requires a reason');
select public.admin_update_order_status((select id from public.orders where idempotency_key = 'b0000000-0000-0000-0000-000000000002'),
  'cancelled', 'Customer changed mind');
select pg_temp.ok((select stock_quantity from public.products where id = :charger) = 79, 'cancellation releases stock');
reset role;

set role service_role;
select pg_temp.ok(exists (select 1 from public.notifications_outbox where event_type = 'order_cancelled'), 'cancellation notifies admins');
update public.orders set payment_due_at = now() - interval '1 minute'
 where idempotency_key = 'b0000000-0000-0000-0000-000000000003';
select pg_temp.throws(format($$select public.submit_payment(%L)$$, jsonb_build_object(
  'order_id', (select id from public.orders where idempotency_key = 'b0000000-0000-0000-0000-000000000003'),
  'access_token_hash', pg_temp.hash('tok-b0000000-0000-0000-0000-000000000003'),
  'receipt', jsonb_build_object('path', 'orders/x/late.png', 'mime', 'image/png', 'size', 1, 'sha256', repeat('c', 64)))),
  'order_expired', 'payment after deadline is refused');
select pg_temp.ok(public.expire_unpaid_orders() = 1, 'expiry job expires overdue unpaid order');
select pg_temp.ok((select stock_quantity from public.products where id = '20000000-0000-0000-0000-000000000003') = 3,
  'expired order releases reserved stock');
select pg_temp.ok(public.expire_unpaid_orders() = 0, 'expiry is idempotent');
select pg_temp.ok((select count(*) from public.order_status_history h join public.orders o on o.id = h.order_id
                   where o.idempotency_key = 'b0000000-0000-0000-0000-000000000003' and h.to_status = 'expired') = 1,
  'expiry recorded in order history');
reset role;

rollback;
