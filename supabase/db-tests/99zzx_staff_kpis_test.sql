-- 0056: staff KPIs + targets; customer messages only for paid orders
\ir _helpers.sql
-- a paid order: placed (no message), receipt, approved by the manager, completed by the manager
set role service_role;
create temp table t_o as select (public.create_order_for_user(:customer, pg_temp.order_payload('d5600000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1)), 'pickup')) ->> 'order_id')::uuid as id;
grant select on t_o to authenticated;
select public.submit_payment(jsonb_build_object('order_id', (select id from t_o), 'access_token_hash', pg_temp.hash('tok-d5600000-0000-0000-0000-000000000001'),
  'receipt', jsonb_build_object('path', 'orders/k/r.png', 'mime', 'image/png', 'size', 100, 'sha256', repeat('a', 64))));
reset role;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where channel in ('email', 'push') and payload ->> 'order_id' = (select id::text from t_o)),
  'no customer message before the payment is accepted');
select pg_temp.login(:manager);
select public.admin_review_payment((select id from public.payment_submissions where order_id = (select id from t_o)), 'verified');
select public.admin_update_order_status((select id from t_o), 'processing');
select public.admin_update_order_status((select id from t_o), 'ready_for_pickup');
select public.admin_update_order_status((select id from t_o), 'completed');
reset role;
select pg_temp.ok(exists (select 1 from public.notifications_outbox where channel = 'email' and event_type = 'customer_order_confirmed' and payload ->> 'order_id' = (select id::text from t_o)),
  'accepted payment: the customer is told (the order exists)');

-- an unpaid checkout that expires: no message
set role service_role;
select public.create_order_for_user(:customer2, pg_temp.order_payload('d5600000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
reset role;
update public.orders set payment_due_at = now() - interval '1 minute' where idempotency_key = 'd5600000-0000-0000-0000-000000000002';
select public.expire_unpaid_orders();
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where channel = 'email' and recipient_user_id = :customer2), 'expired unpaid checkout: no message');

-- KPIs
select pg_temp.login(:customer);
create temp table t_tk as select public.customer_create_ticket('app', '', '', 'Please help with the app') as r;
grant select on t_tk to authenticated;
reset role;
select pg_temp.login(:manager);
select public.admin_update_ticket((select (r ->> 'ticket_id')::uuid from t_tk), null, :manager, false, 'On it', false);
select public.admin_update_ticket((select (r ->> 'ticket_id')::uuid from t_tk), 'resolved');
create temp table t_k as select * from public.admin_staff_kpis(now() - interval '1 day', now() + interval '1 minute');
grant select on t_k to authenticated;
select pg_temp.ok((select payments_approved = 1 and orders_completed = 1 and order_steps = 3 and tickets_resolved = 1 and ticket_replies = 1
                     and ticket_first_reply_hours is not null and ticket_resolution_hours is not null and payment_review_minutes is not null
                   from t_k where user_id = :manager), 'manager: payment approved, order completed, ticket resolved, times measured');
select pg_temp.ok((select count(*) from t_k) >= 3 and (select member_id ~ '^[1-9][0-9]{5}$' from t_k where user_id = :manager), 'one row per staff member with User ID');
select pg_temp.throws($$select public.admin_save_kpi_target('payments_approved', 'week', 20, null)$$, 'forbidden', 'only the Super Admin sets targets');
select pg_temp.ok((select count(*) from public.kpi_targets) = 0, 'manager can read targets (none yet)');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws($$select * from public.admin_staff_kpis(now() - interval '1 day', now())$$, 'forbidden', 'staff cannot see KPIs');
reset role;
select pg_temp.login(:super);
select public.admin_save_kpi_target('payments_approved', 'week', 20, null);
select public.admin_save_kpi_target('payments_approved', 'week', 30, null);
select public.admin_save_kpi_target('payments_approved', 'month', 50, :manager);
select pg_temp.ok((select count(*) from public.kpi_targets) = 2 and (select target from public.kpi_targets where profile_id is null) = 30, 'saving again changes the target; one per person');
select pg_temp.throws($$select public.admin_save_kpi_target('nonsense', 'week', 1, null)$$, '%kpi_targets_metric_check%', 'only known KPIs');
select public.admin_delete_kpi_target((select id from public.kpi_targets where profile_id is not null));
select pg_temp.ok((select count(*) from public.kpi_targets) = 1, 'target removed');
reset role;
select pg_temp.ok(exists (select 1 from public.audit_logs where entity_type = 'kpi_targets'), 'target changes in the activity log');
rollback;
