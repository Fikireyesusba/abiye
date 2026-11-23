-- Customer email notifications (outbox channel 'email')
\ir _helpers.sql

set role service_role;
create temp table t_o as select (public.create_order_for_user(:customer,
  pg_temp.order_payload('e6000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)))) ->> 'order_id')::uuid as id;
grant select on t_o to authenticated, service_role;
select public.submit_payment(jsonb_build_object('order_id', (select id from t_o),
  'access_token_hash', pg_temp.hash('tok-e6000000-0000-0000-0000-000000000001'),
  'receipt', jsonb_build_object('path', 'orders/e6/r1.jpg', 'mime', 'image/jpeg', 'size', 1000, 'sha256', repeat('e', 64))));
reset role;

create function pg_temp.emails(p_event text) returns bigint language sql as $$
  select count(*) from public.notifications_outbox where channel = 'email' and event_type = p_event $$;

select pg_temp.ok(pg_temp.emails('customer_order_placed') = 0,
  'no email for a checkout that is not paid yet (0056: an order exists once its payment is accepted)');

select pg_temp.login(:manager);
select public.admin_review_payment((select id from public.payment_submissions where order_id = (select id from t_o)), 'rejected', 'Amount not in the bank statement');
reset role;
select pg_temp.ok((select payload ->> 'note' from public.notifications_outbox where event_type = 'customer_order_payment_rejected') = 'Amount not in the bank statement',
  'payment rejected: email includes the reason');

select pg_temp.ok(pg_temp.emails('customer_order_cancelled') = 0 and (select status from public.orders where id = (select id from t_o)) = 'cancelled',
  'rejected payment cancels the order; no second "cancelled" email');

-- A new order goes through the steps.
set role service_role;
truncate t_o;
insert into t_o select (public.create_order_for_user(:customer, pg_temp.order_payload('e6000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1)))) ->> 'order_id')::uuid;
select public.submit_payment(jsonb_build_object('order_id', (select id from t_o),
  'access_token_hash', pg_temp.hash('tok-e6000000-0000-0000-0000-000000000002'),
  'receipt', jsonb_build_object('path', 'orders/e6/r2.jpg', 'mime', 'image/jpeg', 'size', 1000, 'sha256', repeat('f', 64))));
reset role;
select pg_temp.login(:manager);
select public.admin_review_payment((select id from public.payment_submissions where order_id = (select id from t_o) and status = 'pending'), 'verified');
select public.admin_update_order_status((select id from t_o), 'processing');
select public.admin_update_order_status((select id from t_o), 'out_for_delivery');
select public.admin_update_order_status((select id from t_o), 'completed');
reset role;
select pg_temp.ok(pg_temp.emails('customer_order_confirmed') = 1, 'payment verified: confirmation email');
select pg_temp.ok((select payload::text not like '%@%' and recipient_user_id = :customer from public.notifications_outbox where channel = 'email' and event_type = 'customer_order_confirmed'),
  'the email address is not stored in the outbox');
select pg_temp.ok(pg_temp.emails('customer_order_processing') = 0, 'internal steps (processing) send no email');
select pg_temp.ok(pg_temp.emails('customer_order_out_for_delivery') = 1 and pg_temp.emails('customer_order_completed') = 1, 'delivery and completion emails');

-- Workers: each channel claims only its own rows
set role service_role;
create temp table t_tg as select * from public.claim_notifications(50);
create temp table t_em as select * from public.claim_outbox('email', 50);
reset role;
select pg_temp.ok((select bool_and(channel = 'telegram') from t_tg) and (select bool_and(channel = 'email') from t_em) and (select count(*) from t_em) >= 4,
  'Telegram and email workers claim only their own channel');
select pg_temp.throws($$insert into public.notifications_outbox (channel, event_type, dedupe_key, payload) values ('email', 'customer_x', 'x', '{}')$$,
  '%notifications_outbox_email_recipient%', 'an email always has a recipient account');
select pg_temp.login(:customer);
select pg_temp.throws($$select * from public.claim_outbox('email', 1)$$, '%permission denied%', 'only the server can claim emails');
reset role;

-- Printing: quote ready and ready to collect
insert into public.printing_jobs (id, access_token_hash, customer_name, customer_phone, color_mode, paper_size, sides, copies, status, user_id)
values ('e6000000-0000-0000-0000-0000000000aa', pg_temp.hash('job-e6'), 'Print Customer', '+251933445566', 'bw', 'A4', 'single', 1, 'awaiting_quote', :customer);
select pg_temp.login(:manager);
select public.admin_quote_printing_job('e6000000-0000-0000-0000-0000000000aa', 10);
reset role;
select pg_temp.ok(pg_temp.emails('customer_printing_quote_ready') = 1, 'printing quote ready: email');
update public.printing_jobs set status = 'ready' where id = 'e6000000-0000-0000-0000-0000000000aa';
select pg_temp.ok(pg_temp.emails('customer_printing_ready') = 1, 'printing ready: email');
rollback;
