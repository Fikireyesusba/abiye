-- Wallet (shop credit): top-ups, limit, paying orders, refunds, permissions
\ir _helpers.sql

create function pg_temp.topup(p_user uuid, p_amount text) returns jsonb language sql as $$
  select public.submit_wallet_topup(p_user, jsonb_build_object('amount_etb', p_amount, 'transaction_reference', 'FT' || md5(random()::text),
    'receipt', jsonb_build_object('path', 'topups/' || p_user || '/' || gen_random_uuid() || '.png', 'mime', 'image/png', 'size', 100,
      'sha256', encode(sha256(random()::text::bytea), 'hex')))) $$;
create function pg_temp.balance(p_user uuid) returns numeric language sql as $$
  select coalesce(wallet_balance_etb, 0) from public.customer_accounts where id = p_user $$;
create function pg_temp.order_input(p_key uuid, p_qty integer, p_method text) returns jsonb language sql as $$
  select pg_temp.order_payload(p_key, jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',p_qty)), 'pickup')
         || jsonb_build_object('payment_method', p_method) $$;

-- top-up request
set role service_role;
create temp table t_t1 as select pg_temp.topup(:customer, '3000') as r;
grant select on t_t1 to authenticated;
select pg_temp.throws($$select pg_temp.topup('cccccccc-0000-0000-0000-000000000001', '8000')$$, 'wallet_limit', 'pending top-ups count toward the 10,000 limit');
select pg_temp.throws($$select pg_temp.topup('cccccccc-0000-0000-0000-000000000001', '5')$$, 'invalid_amount', 'minimum 10 ETB');
select pg_temp.throws($$select pg_temp.topup('cccccccc-0000-0000-0000-000000000001', '12.345')$$, 'invalid_amount', 'at most 2 decimals');
select pg_temp.throws($$select pg_temp.topup('aaaaaaaa-0000-0000-0000-000000000003', '100')$$, '%', 'staff cannot top up (not a customer)');
select pg_temp.throws(format($$select public.submit_wallet_topup('cccccccc-0000-0000-0000-000000000001', %L)$$,
  jsonb_build_object('amount_etb','100','receipt',jsonb_build_object('path','topups/cccccccc-0000-0000-0000-000000000002/' || gen_random_uuid() || '.png','mime','image/png','size',1,'sha256',repeat('a',64)))),
  'upload_failed', 'receipt must be in the customer''s own folder');
reset role;
select pg_temp.ok(pg_temp.balance(:customer) = 0, 'nothing credited before verification');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'wallet_topup') = 1, 'staff alerted with the receipt');

-- permissions
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_review_topup(%L, 'verified')$$, (select (r ->> 'topup_id') from t_t1)), 'forbidden', 'staff cannot verify top-ups');
reset role;
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.wallet_topups) = 1, 'customer sees own top-up');
select pg_temp.throws($$select public.submit_wallet_topup('cccccccc-0000-0000-0000-000000000001', '{}')$$, '%permission denied%', 'customers cannot call top-up directly');
select pg_temp.throws($$update public.customer_accounts set wallet_balance_etb = 9999 where id = 'cccccccc-0000-0000-0000-000000000001'$$, '%permission denied%', 'customers cannot edit their balance');
reset role;
select pg_temp.login(:customer2);
select pg_temp.ok((select count(*) from public.wallet_topups) = 0, 'other customers see nothing');
reset role;

-- manager verifies
select pg_temp.login(:manager);
select public.admin_review_topup((select (r ->> 'topup_id')::uuid from t_t1), 'verified');
select pg_temp.throws(format($$select public.admin_review_topup(%L, 'verified')$$, (select (r ->> 'topup_id') from t_t1)), 'already_reviewed', 'cannot verify twice');
select pg_temp.throws($$select public.admin_adjust_wallet('cccccccc-0000-0000-0000-000000000001', 100, 'gift')$$, 'forbidden', 'managers cannot adjust balances manually');
reset role;
select pg_temp.ok(pg_temp.balance(:customer) = 3000, 'balance credited after verification');
select pg_temp.ok((select balance_after_etb from public.wallet_ledger where user_id = :customer order by id desc limit 1) = 3000, 'ledger records the balance');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'customer_topup_verified' and channel = 'email') = 1, 'customer notified');
select pg_temp.throws($$update public.wallet_ledger set amount_etb = 1$$, '%append-only%', 'ledger cannot be changed');

-- rejection needs a reason
set role service_role;
create temp table t_t2 as select pg_temp.topup(:customer, '100') as r;
grant select on t_t2 to authenticated;
reset role;
select pg_temp.login(:manager);
select pg_temp.throws(format($$select public.admin_review_topup(%L, 'rejected')$$, (select (r ->> 'topup_id') from t_t2)), 'note_required', 'rejecting needs a reason');
select public.admin_review_topup((select (r ->> 'topup_id')::uuid from t_t2), 'rejected', 'Not in our bank statement');
reset role;
select pg_temp.ok(pg_temp.balance(:customer) = 3000, 'rejected top-up credits nothing');

-- paying orders: only if the balance covers everything
set role service_role;
select pg_temp.throws(format($$select public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', %L)$$, pg_temp.order_input(gen_random_uuid(), 4, 'wallet')),
  'wallet_insufficient', 'balance must cover the whole order (3,400 > 3,000)');
reset role;
select pg_temp.ok((select count(*) from public.orders where user_id = :customer) = 0, 'failed wallet checkout creates no order (stock is not reserved)');
set role service_role;
create temp table t_o as select public.create_order_for_user(:customer, pg_temp.order_input('e9000000-0000-0000-0000-000000000001', 2, 'wallet')) as r;
grant select on t_o to authenticated;
reset role;
select pg_temp.ok((select status = 'confirmed' and payment_status = 'verified' and payment_method = 'wallet' and payment_verified_at is not null
                     from public.orders where id = (select (r ->> 'order_id')::uuid from t_o)), 'balance-paid order is confirmed immediately');
select pg_temp.ok(pg_temp.balance(:customer) = 1300, 'balance debited by the order total (1,700)');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'customer_order_placed' and payload ->> 'order_id' = (select r ->> 'order_id' from t_o)) = 0,
  'no "please pay by bank transfer" message for a paid order');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'wallet_order_paid') = 1, 'staff alerted about the paid order');
set role service_role;
select pg_temp.ok((public.create_order_for_user(:customer, pg_temp.order_input('e9000000-0000-0000-0000-000000000001', 2, 'wallet')) ->> 'replayed')::boolean
  and pg_temp.balance(:customer) = 1300, 'retrying the same checkout does not charge twice');
reset role;

-- cancelling refunds the balance
select pg_temp.login(:manager);
select public.admin_update_order_status((select (r ->> 'order_id')::uuid from t_o), 'cancelled', 'Out of stock');
reset role;
select pg_temp.ok(pg_temp.balance(:customer) = 3000, 'cancelled order refunded to the balance');
select pg_temp.ok((select payment_status from public.orders where id = (select (r ->> 'order_id')::uuid from t_o)) = 'refunded', 'order marked refunded');

-- super admin adjustment within the limit
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_adjust_wallet('cccccccc-0000-0000-0000-000000000001', 7001, 'gift')$$, 'wallet_limit', 'manual credit respects the limit');
select pg_temp.throws($$select public.admin_adjust_wallet('cccccccc-0000-0000-0000-000000000001', -3001, 'fix')$$, 'wallet_insufficient', 'balance cannot go below zero');
select pg_temp.throws($$select public.admin_adjust_wallet('cccccccc-0000-0000-0000-000000000001', 50, '')$$, 'invalid_reason', 'adjustment needs a reason');
select public.admin_adjust_wallet(:customer, -500, 'Correction');
select pg_temp.ok((select count(*) from public.admin_wallet_balances() where user_id = :customer and balance_etb = 2500) = 1, 'balances overview');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action in ('topup_verified', 'topup_rejected', 'wallet_adjusted') and entity_id = :customer::text) = 3,
  'every review and adjustment is in the activity log');

-- uploaded top-up receipts are never swept as orphans
insert into storage.objects (bucket_id, name, created_at) select 'payment-receipts', receipt_path, now() - interval '3 days' from public.wallet_topups;
set role service_role;
select pg_temp.ok((select count(*) from public.storage_orphans() o join public.wallet_topups t on t.receipt_path = o.name) = 0, 'top-up receipts are kept');
reset role;
rollback;
