-- 0052: activity with User IDs, signed-in users + sign out, app installs, printing rejection, support tickets
\ir _helpers.sql
create temp table t_ids as select (select member_id from public.customer_accounts where id = :customer) as cust, (select member_id from public.customer_accounts where id = :super) as sup;
grant select on t_ids to authenticated;

-- ---------------------------------------------------------------- activity: who + about whom, searchable by User ID
select pg_temp.login(:super);
select public.admin_block_email('blocked-x@example.com', 'test');
create temp table t_act as select * from public.admin_activity_by_category(null, (select sup from t_ids), 50);
grant select on t_act to authenticated;
select pg_temp.ok((select count(*) from t_act) >= 1 and (select bool_and(actor_member_id = (select sup from t_ids) or subject_member_id = (select sup from t_ids)) from t_act),
  'activity searched by a User ID: entries by or about that person');
reset role;

-- ---------------------------------------------------------------- signed-in users, last sign-in, sign out
insert into auth.sessions (id, user_id, created_at, updated_at) values ('5e550000-0000-0000-0000-000000000001', :customer, now() - interval '1 hour', now());
update auth.users set last_sign_in_at = now() - interval '40 days' where id = :customer;
select pg_temp.login(:super);
select pg_temp.ok((select member_id from public.admin_signed_in_users() where user_id = :customer) = (select cust from t_ids), 'signed-in list shows the customer with their User ID');
select pg_temp.ok(exists (select 1 from public.admin_last_sign_ins(null, null, now() - interval '30 days') where user_id = :customer and signed_in_now),
  '"not signed in since" filter finds the customer');
select pg_temp.ok(not exists (select 1 from public.admin_last_sign_ins(now() - interval '7 days', now()) where user_id = :customer), 'date range filter');
select pg_temp.ok(public.admin_sign_out_user(:customer) = 1, 'customer signed out');
select pg_temp.ok(not exists (select 1 from public.admin_signed_in_users() where user_id = :customer), 'no longer signed in');
select pg_temp.throws($$select public.admin_sign_out_user('aaaaaaaa-0000-0000-0000-000000000001')$$, 'cannot_modify_self', 'not yourself');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'user_signed_out' and entity_id = 'cccccccc-0000-0000-0000-000000000001'), 'sign-out recorded');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select * from public.admin_signed_in_users()$$, 'forbidden', 'managers cannot see sessions');
select pg_temp.throws($$select public.admin_sign_out_user('cccccccc-0000-0000-0000-000000000001')$$, 'forbidden', 'managers cannot sign people out');
reset role;

-- ---------------------------------------------------------------- app installs
select pg_temp.login(:customer);
select pg_temp.throws($$select public.record_app_install(gen_random_uuid(), 'android')$$, '%permission denied%', 'only the server records installs');
select pg_temp.throws($$select * from public.app_installs$$, '%permission denied%', 'install list not readable directly');
reset role;
set role service_role;
select public.record_app_install('a9900000-0000-0000-0000-000000000001', 'android', :customer);
select public.record_app_install('a9900000-0000-0000-0000-000000000001', 'android', null);
select public.record_app_install('a9900000-0000-0000-0000-000000000002', 'nonsense', null);
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.admin_app_installs()) = 2 and (select opens from public.admin_app_installs() where device_id = 'a9900000-0000-0000-0000-000000000001') = 2
  and (select member_id from public.admin_app_installs() where device_id = 'a9900000-0000-0000-0000-000000000001') = (select cust from t_ids)
  and (select platform from public.admin_app_installs() where device_id = 'a9900000-0000-0000-0000-000000000002') = 'other',
  'installs counted per device, linked to the account, with User ID');
reset role;

-- ---------------------------------------------------------------- printing: rejected payment → job + order cancelled, files due now
set role service_role;
select public.create_printing_job_for_user(:customer, pg_temp.job_payload('c9900000-0000-0000-0000-000000000001', 5));
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where dedupe_key like 'printing_job:c9900000%' or dedupe_key like 'printing_document:%'), 'no alert for a new printing request');
select public.create_order_for_user(:customer, pg_temp.order_payload('b9900000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'printing', 'printing_job_id', 'c9900000-0000-0000-0000-000000000001', 'access_token_hash', pg_temp.hash('job-c9900000-0000-0000-0000-000000000001'))), 'pickup'));
select public.submit_payment(jsonb_build_object('order_id', (select id from public.orders where idempotency_key = 'b9900000-0000-0000-0000-000000000001'),
  'access_token_hash', pg_temp.hash('tok-b9900000-0000-0000-0000-000000000001'),
  'receipt', jsonb_build_object('path', 'orders/p/r9.pdf', 'mime', 'application/pdf', 'size', 5000, 'sha256', repeat('9', 64))));
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'printing_document' and payload ->> 'job_id' = 'c9900000-0000-0000-0000-000000000001') = 1,
  'payment submitted: the document goes to the printing group');
reset role;
select pg_temp.login(:super);
select public.admin_review_payment((select s.id from public.payment_submissions s join public.orders o on o.id = s.order_id where o.idempotency_key = 'b9900000-0000-0000-0000-000000000001'),
  'rejected', 'Wrong amount');
reset role;
select pg_temp.ok((select status from public.printing_jobs where id = 'c9900000-0000-0000-0000-000000000001') = 'cancelled'
  and (select status from public.orders where idempotency_key = 'b9900000-0000-0000-0000-000000000001') = 'cancelled', 'payment rejected: printing job and order cancelled');
select pg_temp.ok((select files_delete_after <= now() from public.printing_jobs where id = 'c9900000-0000-0000-0000-000000000001'), 'its documents are due for deletion now');
select pg_temp.ok(not exists (select 1 from public.printing_files_due_for_deletion(100) where job_id = 'c9900000-0000-0000-0000-000000000001'), '…after their Telegram copy is sent');
update public.notifications_outbox set status = 'sent', sent_at = now() where event_type = 'printing_document' and payload ->> 'job_id' = 'c9900000-0000-0000-0000-000000000001';
select pg_temp.ok(exists (select 1 from public.printing_files_due_for_deletion(100) where job_id = 'c9900000-0000-0000-0000-000000000001'), 'then deleted from storage (kept in Telegram)');

-- ---------------------------------------------------------------- support tickets
select pg_temp.login(:customer);
select pg_temp.throws($$select public.customer_create_ticket('order', '', '', 'My order did not arrive yet')$$, 'order_not_found', 'order topic needs an order number');
select pg_temp.throws($$select public.customer_create_ticket('order', 'ET-99999999', '', 'My order did not arrive yet')$$, 'order_not_found', 'only the customer''s own orders');
select pg_temp.throws($$select public.customer_create_ticket('other', '', '', 'Something else entirely')$$, 'invalid_request', '"other" needs a title');
select pg_temp.throws($$select public.customer_create_ticket('app', '', '', 'short')$$, 'invalid_request', 'details are required (10+ characters)');
create temp table t_tk as select public.customer_create_ticket('order', lower((select order_number from public.orders where idempotency_key = 'b9900000-0000-0000-0000-000000000001')), '', 'Payment was rejected but I paid the right amount') as r;
grant select on t_tk to authenticated;
select pg_temp.ok((select (r ->> 'ticket_number') ~ '^T-[0-9]+$' from t_tk), 'ticket created with a number');
select public.customer_create_ticket('other', '', 'Suggestion', 'Please add more colours of phone cases');
select pg_temp.ok((select count(*) from public.support_tickets) = 2, 'customer sees their own tickets');
reset role;
select pg_temp.ok((select order_number from public.support_tickets where id = (select (r ->> 'ticket_id')::uuid from t_tk)) like 'ET-%'
  and (select payload ->> 'user_id' from public.notifications_outbox where event_type = 'support_ticket' limit 1) = (select cust from t_ids)
  and private.telegram_group('support_ticket') = 'support', 'linked to the order; Telegram support group gets it with the User ID');
select pg_temp.login(:customer2);
select pg_temp.ok((select count(*) from public.support_tickets) = 0, 'other customers cannot see it');
select pg_temp.throws(format($$select public.customer_reply_ticket(%L, 'hi')$$, (select (r ->> 'ticket_id') from t_tk)), 'not_found', 'nor reply to it');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws($$select * from public.admin_support_tickets()$$, 'forbidden', 'staff without support.view cannot see tickets');
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.admin_support_tickets(null, (select cust from t_ids))) = 2, 'manager finds tickets by User ID');
select public.admin_update_ticket((select (r ->> 'ticket_id')::uuid from t_tk), null, :manager, false, 'Checking it now', true);
select public.admin_update_ticket((select (r ->> 'ticket_id')::uuid from t_tk), null, null, false, 'Please send the bank receipt again', false);
select pg_temp.ok((select status from public.support_tickets where id = (select (r ->> 'ticket_id')::uuid from t_tk)) = 'waiting_customer', 'a reply waits for the customer');
reset role;
select pg_temp.ok(exists (select 1 from public.notifications_outbox where event_type = 'customer_ticket_update' and recipient_user_id = :customer and payload ->> 'message' like 'Please send%'),
  'customer gets an email about the reply');
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.support_ticket_messages) = 1, 'customer does not see internal notes');
select public.customer_reply_ticket((select (r ->> 'ticket_id')::uuid from t_tk), 'Sent it again');
select pg_temp.ok((select status from public.support_tickets where id = (select (r ->> 'ticket_id')::uuid from t_tk)) = 'open', 'customer reply re-opens it');
reset role;
select pg_temp.login(:manager);
select public.admin_update_ticket((select (r ->> 'ticket_id')::uuid from t_tk), 'closed');
select pg_temp.ok((select closed_at is not null from public.support_tickets where id = (select (r ->> 'ticket_id')::uuid from t_tk)), 'closed');
reset role;
select pg_temp.login(:customer);
select pg_temp.throws(format($$select public.customer_reply_ticket(%L, 'more')$$, (select (r ->> 'ticket_id') from t_tk)), 'invalid_transition', 'closed tickets are final');
select pg_temp.throws($$insert into public.support_tickets (user_id, category, subject, details) values (auth.uid(), 'app', 'x x x', 'direct insert attempt')$$, '%permission denied%', 'no direct writes');
reset role;
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'ticket_updated'), 'ticket changes recorded');
rollback;
