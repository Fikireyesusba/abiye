-- Export of reviewed payments and wallet top-ups (earlier tests left reviewed rows behind)
\ir _helpers.sql

-- setup: two bank-transfer orders with receipts (one verified, one rejected) and two reviewed top-ups
create function pg_temp.paid_order(p_key uuid, p_ref text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform public.create_order_for_user('cccccccc-0000-0000-0000-000000000001', pg_temp.order_payload(p_key, jsonb_build_array(
    jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1))));
  select id into v_id from public.orders where idempotency_key = p_key;
  perform public.submit_payment(jsonb_build_object('order_id', v_id, 'access_token_hash', pg_temp.hash('tok-' || p_key),
    'transaction_reference', p_ref, 'receipt', jsonb_build_object('path', 'orders/' || v_id || '/r.png', 'mime', 'image/png', 'size', 100,
    'sha256', encode(sha256(p_ref::bytea), 'hex'))));
  return v_id;
end $$;
create temp table t_pay as select pg_temp.paid_order('e0000000-0000-0000-0000-000000000001', 'FTEXPORT001') as o1,
                                  pg_temp.paid_order('e0000000-0000-0000-0000-000000000002', 'FTEXPORT002') as o2;
create temp table t_top as select (pg_temp_topup.r ->> 'topup_id')::uuid as id from (select public.submit_wallet_topup(:customer, jsonb_build_object(
    'amount_etb', '500', 'transaction_reference', 'FT' || md5(g::text), 'receipt', jsonb_build_object('path', 'topups/' || :customer || '/' || gen_random_uuid() || '.png',
    'mime', 'image/png', 'size', 100, 'sha256', encode(sha256(('t' || g)::bytea), 'hex')))) as r from generate_series(1, 2) g) pg_temp_topup;
grant select on t_pay, t_top to authenticated;
select pg_temp.login(:manager);
select public.admin_review_payment((select id from public.payment_submissions where order_id = (select o1 from t_pay)), 'verified');
select public.admin_review_payment((select id from public.payment_submissions where order_id = (select o2 from t_pay)), 'rejected', 'Not in our bank statement');
select public.admin_review_topup((select id from t_top order by id limit 1), 'verified');
select public.admin_review_topup((select id from t_top order by id desc limit 1), 'rejected', 'Wrong amount');
reset role;
select pg_temp.ok((select count(*) from public.payment_submissions where status in ('verified', 'rejected')) >= 2, 'setup: reviewed payments exist');

select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.admin_payments_export(now() - interval '1 day', now() + interval '1 minute'))
                  = (select count(*) from public.payment_submissions where status in ('verified', 'rejected') and reviewed_at > now() - interval '1 day'),
                  'manager exports all verified and rejected payments');
select pg_temp.ok((select reviewed_by_name is not null and customer_email is not null and bank_name is not null
                     from public.admin_payments_export(now() - interval '1 day', now() + interval '1 minute') where transaction_reference = 'FTEXPORT002'),
                  'shows who reviewed, the customer''s email and the bank account');
select pg_temp.ok((select bool_and(status = 'rejected' and review_note is not null) from public.admin_payments_export(now() - interval '1 day', now() + interval '1 minute', 'rejected')),
                  'rejected filter with reasons');
select pg_temp.ok((select bool_and(order_number is not null and customer_phone is not null and reviewed_at is not null and amount_expected_etb > 0)
                     from public.admin_payments_export(now() - interval '1 day', now() + interval '1 minute')), 'rows carry order, customer and review details');
select pg_temp.ok((select count(*) from public.admin_payments_export(now() - interval '1 day', now() + interval '1 minute') where status = 'pending') = 0, 'pending payments are not exported');
select pg_temp.throws($$select * from public.admin_payments_export(now() - interval '1 day', now(), 'pending')$$, 'invalid_request', 'only verified / rejected');
select pg_temp.throws($$select * from public.admin_payments_export(now() - interval '400 days', now())$$, 'invalid_request', 'at most one year at a time');
select pg_temp.ok((select count(*) from public.admin_topups_export(now() - interval '1 day', now() + interval '1 minute')) >= 2, 'manager exports reviewed top-ups');
select pg_temp.throws($$select public.admin_log_export('payments', '{"rows":3}')$$, 'forbidden', 'managers cannot download the Excel file (Super Admin only)');
reset role;
select pg_temp.login(:super);
select public.admin_log_export('payments', '{"rows":3}');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'export_payments' and actor_id = :super) = 1, 'payment export recorded');

select pg_temp.login(:staff);
select pg_temp.throws($$select * from public.admin_topups_export(now() - interval '1 day', now())$$, 'forbidden', 'staff cannot export top-ups');
reset role;
select pg_temp.login(:outsider);
select pg_temp.throws($$select * from public.admin_payments_export(now() - interval '1 day', now())$$, 'forbidden', 'non-staff cannot export payments');
select pg_temp.throws($$select public.admin_log_export('payments', '{}')$$, 'forbidden', 'non-staff cannot record a payment export');
reset role;
select pg_temp.login(:customer);
select pg_temp.throws($$select * from public.admin_payments_export(now() - interval '1 day', now())$$, 'forbidden', 'customers cannot export payments');
reset role;
set role anon;
select pg_temp.throws($$select * from public.admin_payments_export(now() - interval '1 day', now())$$, '%permission denied%', 'anonymous visitors cannot call it');
reset role;
