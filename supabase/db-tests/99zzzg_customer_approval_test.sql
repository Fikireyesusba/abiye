-- 0069: new customer accounts wait for approval; browse + support only until approved; reject blocks the email.
\ir _helpers.sql
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('dddddddd-0000-0000-0000-000000000001', 'newbie@test.local', now(), '{"full_name":"New Person","accepted_terms":"true"}'),
  ('dddddddd-0000-0000-0000-000000000002', 'shady@test.local', now(), '{"full_name":"Shady","accepted_terms":"true"}');

select pg_temp.ok((select approval_status from public.customer_accounts where id = 'dddddddd-0000-0000-0000-000000000001') = 'pending', 'a new account starts under verification');
select pg_temp.ok((select approval_status from public.customer_accounts where id = :customer) = 'approved', 'existing accounts are approved');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'account_pending'
                     and payload ->> 'user_id' = (select member_id::text from public.customer_accounts where id = 'dddddddd-0000-0000-0000-000000000001')) = 1
                  and private.telegram_group('account_pending') = 'security', 'new account announced in the security group (User ID)');

-- pending: no ordering, top-ups, reviews or stock alerts; support works
set role service_role;
select pg_temp.throws($$select public.create_order_for_user('dddddddd-0000-0000-0000-000000000001', pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup'))$$,
  'account_pending', 'pending: cannot order');
select pg_temp.throws($$select public.submit_wallet_topup('dddddddd-0000-0000-0000-000000000001', '{}'::jsonb)$$, 'account_pending', 'pending: cannot top up');
reset role;
select pg_temp.login('dddddddd-0000-0000-0000-000000000001');
select pg_temp.throws($$select public.submit_product_review('20000000-0000-0000-0000-000000000007', 5, 'Great')$$, 'account_pending', 'pending: cannot review');
select pg_temp.ok((select count(*) from public.customer_accounts where id = 'dddddddd-0000-0000-0000-000000000001') = 1, 'pending: can see their own account');
select pg_temp.throws($$update public.customer_accounts set approval_status = 'approved' where id = 'dddddddd-0000-0000-0000-000000000001'$$, '%permission denied%',
  'a customer cannot approve themselves');
reset role;

-- who decides
select pg_temp.login(:staff);
select pg_temp.throws($$select public.admin_approve_customer('dddddddd-0000-0000-0000-000000000001')$$, 'forbidden', 'staff without the permission cannot approve');
select pg_temp.throws($$select * from public.admin_pending_customers()$$, 'forbidden', '… nor list pending accounts');
reset role;
select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_pending_customers() where email in ('newbie@test.local', 'shady@test.local')) = 2, 'approver sees the pending accounts with their details');
select public.admin_approve_customer('dddddddd-0000-0000-0000-000000000001');
select pg_temp.throws($$select public.admin_approve_customer('dddddddd-0000-0000-0000-000000000001')$$, 'invalid_transition', 'cannot decide twice');
select pg_temp.throws($$select public.admin_reject_customer('dddddddd-0000-0000-0000-000000000002', 'no')$$, 'invalid_reason', 'rejecting needs a reason');
create temp table t_rej as select public.admin_reject_customer('dddddddd-0000-0000-0000-000000000002', 'Details do not match') as r;
reset role;
select pg_temp.ok((select approval_status = 'approved' and approved_by = :super from public.customer_accounts where id = 'dddddddd-0000-0000-0000-000000000001'),
  'approved (who and when kept)');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'customer_account_approved' and recipient_user_id = 'dddddddd-0000-0000-0000-000000000001') = 1,
  'approved customer is emailed');
set role service_role;
select pg_temp.ok((select (public.create_order_for_user('dddddddd-0000-0000-0000-000000000001', pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')) ->> 'order_number') is not null),
  'approved: can order');
reset role;
select pg_temp.ok((select r ->> 'email' from t_rej) = 'shady@test.local', 'reject returns the email for the customer message');
select pg_temp.ok((select reason like 'Account rejected: Details do not match%' from public.blocked_emails where email = 'shady@test.local'), 'rejected email is on the block list with the reason');
select pg_temp.ok((select count(*) from public.audit_logs where action in ('account_approved', 'account_rejected')) = 2, 'both decisions in the Activity log');
rollback;
