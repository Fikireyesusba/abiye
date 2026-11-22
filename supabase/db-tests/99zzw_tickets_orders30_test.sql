-- 0054: ticket rating / 24 h visibility / 48 h auto-close; 30-minute payment window; export-then-clear tickets
\ir _helpers.sql
select pg_temp.login(:customer);
create temp table t_tk as select public.customer_create_ticket('app', '', '', 'The page does not load on my phone') as r;
grant select on t_tk to authenticated, service_role;
select pg_temp.throws(format($$select public.customer_rate_ticket(%L, 5)$$, (select r ->> 'ticket_id' from t_tk)), 'invalid_transition', 'cannot rate an open ticket');
reset role;

-- 48 h without an answer → closed automatically
select pg_temp.login(:manager);
select public.admin_update_ticket((select (r ->> 'ticket_id')::uuid from t_tk), null, null, false, 'Which phone do you use?', false);
reset role;
update public.support_tickets set last_message_at = now() - interval '49 hours' where id = (select (r ->> 'ticket_id')::uuid from t_tk);
select pg_temp.ok(public.close_stale_tickets() = 1, 'waiting 48 h for the customer → closed');
select pg_temp.ok((select status = 'closed' and closed_at is not null from public.support_tickets where id = (select (r ->> 'ticket_id')::uuid from t_tk)), 'status closed');
select pg_temp.ok(exists (select 1 from public.notifications_outbox where event_type = 'customer_ticket_update' and payload ->> 'status' = 'closed'), 'customer told it was closed');
select pg_temp.ok(public.close_stale_tickets() = 0, 'only once');

-- rating
select pg_temp.login(:customer);
select pg_temp.throws(format($$select public.customer_rate_ticket(%L, 6)$$, (select r ->> 'ticket_id' from t_tk)), 'invalid_request', 'rating is 1–5');
select public.customer_rate_ticket((select (r ->> 'ticket_id')::uuid from t_tk), 4, 'Quick answer');
select pg_temp.throws(format($$select public.customer_rate_ticket(%L, 5)$$, (select r ->> 'ticket_id' from t_tk)), 'already_reviewed', 'rated once');
select pg_temp.ok((select count(*) from public.support_tickets) = 1, 'a closed ticket is still visible for 24 h');
reset role;
select pg_temp.ok((select rating from public.support_tickets where id = (select (r ->> 'ticket_id')::uuid from t_tk)) = 4, 'rating stored');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'ticket_rated' and after_data ->> 'feedback' = 'Quick answer'), 'rating feedback in the activity log');
select pg_temp.ok((select payload ->> 'feedback' from public.notifications_outbox where event_type = 'support_rating') = 'Quick answer'
  and private.telegram_group('support_rating') = 'support', 'rating and feedback sent to the support group');
update public.support_tickets set closed_at = now() - interval '25 hours' where id = (select (r ->> 'ticket_id')::uuid from t_tk);
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.support_tickets) = 0 and (select count(*) from public.support_ticket_messages) = 0, 'closed > 24 h ago: gone from the customer app');
select pg_temp.throws(format($$select public.customer_reply_ticket(%L, 'hello?')$$, (select r ->> 'ticket_id' from t_tk)), 'not_found', 'and cannot be answered');
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select rating from public.admin_support_tickets() where id = (select (r ->> 'ticket_id')::uuid from t_tk)) = 4, 'staff still see it with the rating');

-- clearing: only after the export
select pg_temp.throws(format($$select public.admin_clear_tickets(%L, %L)$$, (now() at time zone 'Europe/Warsaw')::date, (now() at time zone 'Europe/Warsaw')::date), 'invalid_request', 'export first');
select public.admin_log_export('support', jsonb_build_object('from', (now() at time zone 'Europe/Warsaw')::date, 'to', (now() at time zone 'Europe/Warsaw')::date));
select pg_temp.ok(public.admin_clear_tickets((now() at time zone 'Europe/Warsaw')::date, (now() at time zone 'Europe/Warsaw')::date) = 1, 'closed tickets cleared after the export');
reset role;
select pg_temp.ok(not exists (select 1 from public.support_tickets), 'deleted');

-- 30-minute payment window; overdue orders are released before a new order
set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload('d3000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000003', 'quantity', 3))));
reset role;
select pg_temp.ok((select payment_due_at between now() + interval '29 minutes' and now() + interval '31 minutes' from public.orders where idempotency_key = 'd3000000-0000-0000-0000-000000000001'),
  'unpaid order is held for 30 minutes');
set role service_role;
select pg_temp.throws(format($$select public.create_order_for_user(%L, %L)$$, 'cccccccc-0000-0000-0000-000000000002', pg_temp.order_payload('d3000000-0000-0000-0000-000000000002', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000003', 'quantity', 1)))), 'out_of_stock', 'while held, nobody else can buy the last units');
reset role;
update public.orders set payment_due_at = now() - interval '1 minute' where idempotency_key = 'd3000000-0000-0000-0000-000000000001';
set role service_role;
select public.create_order_for_user('cccccccc-0000-0000-0000-000000000002', pg_temp.order_payload('d3000000-0000-0000-0000-000000000003', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000003', 'quantity', 1))));
reset role;
select pg_temp.ok((select status from public.orders where idempotency_key = 'd3000000-0000-0000-0000-000000000001') = 'expired'
  and exists (select 1 from public.orders where idempotency_key = 'd3000000-0000-0000-0000-000000000003'), 'after 30 minutes the next buyer gets it (first to pay)');
select pg_temp.ok((select note from public.order_status_history h join public.orders o on o.id = h.order_id
                   where o.idempotency_key = 'd3000000-0000-0000-0000-000000000003' order by h.id limit 1) = 'Order created', 'the new order does not inherit the expiry note');
rollback;
