-- 0064: promotion changes are security alerts in Telegram; Excel copies go through the queue to the receipts group.
\ir _helpers.sql

select pg_temp.ok(private.telegram_group('promotion_alert') = 'security' and private.telegram_group('excel_export') = 'receipts',
  'promotion alerts → security group; Excel copies → receipts group');

select pg_temp.login(:manager);
insert into public.promotions (id, title_en, title_am, code, discount_type, discount_value, restricted, min_order_etb)
values ('64000000-0000-0000-0000-000000000001', 'Holiday', 'Holiday', 'HOLI64', 'percent', 15, true, 500);
reset role;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'change' = 'created'
                     and payload ->> 'code' = 'HOLI64' and payload ->> 'discount' = '15% off' and payload ->> 'audience' = 'Selected customers'
                     and payload ->> 'by_user_id' = (select member_id::text from public.customer_accounts where id = :manager)) = 1,
  'creating a promotion: security alert with code, discount, audience and who did it');

select pg_temp.login(:manager);
update public.promotions set discount_value = 20, ends_at = now() + interval '7 days' where id = '64000000-0000-0000-0000-000000000001';
update public.promotions set updated_at = now() where id = '64000000-0000-0000-0000-000000000001';
select public.admin_assign_promotion('64000000-0000-0000-0000-000000000001', array['customer@test.local'], false);
select public.admin_unassign_promotion('64000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Wrong customer');
select public.admin_revoke_promotion('64000000-0000-0000-0000-000000000001', 'Holiday cancelled');
reset role;
select pg_temp.ok((select payload ->> 'changed' from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'change' = 'changed'
                     and payload ->> 'code' = 'HOLI64') = 'discount, dates', 'changing a promotion: alert says what changed');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'code' = 'HOLI64' and payload ->> 'change' = 'changed') = 1,
  'no alert when nothing visible changed');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'code' = 'HOLI64'
                     and ((payload ->> 'change' = 'given' and payload ->> 'user_id' = (select member_id::text from public.customer_accounts where id = :customer))
                       or (payload ->> 'change' = 'removed' and payload ->> 'reason' = 'Wrong customer'))) = 2,
  'giving / removing a code: alert with the customer''s User ID (and the reason)');
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'code' = 'HOLI64'
                     and payload ->> 'change' = 'revoked' and payload ->> 'reason' = 'Holiday cancelled') = 1, 'revoking: alert with the reason');
select pg_temp.login(:super);
select public.admin_delete_promotion('64000000-0000-0000-0000-000000000001');
reset role;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'code' = 'HOLI64'
                     and payload ->> 'change' = 'deleted' and payload ->> 'by_user_id' = (select member_id::text from public.customer_accounts where id = :super)) = 1,
  'deleting: alert with who did it');

-- Code used: when the order is paid
insert into public.promotions (id, title_en, title_am, code, discount_type, discount_value)
values ('64000000-0000-0000-0000-000000000002', 'Ten off', 'Ten off', 'TEN64', 'fixed', 10);
set role service_role;
create temp table t_o as select public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')
  || jsonb_build_object('promotion_code', 'TEN64')) as r;
reset role;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'change' = 'used' and payload ->> 'code' = 'TEN64') = 0,
  'no "code used" alert before the payment is approved');
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = (select (r ->> 'order_id')::uuid from t_o);
select pg_temp.ok((select (payload ->> 'original_etb')::numeric - (payload ->> 'discount_etb')::numeric = (payload ->> 'total_etb')::numeric
                     and (payload ->> 'discount_etb')::numeric = 10 and payload ->> 'order_number' is not null
                     and payload ->> 'user_id' = (select member_id::text from public.customer_accounts where id = :customer)
                   from public.notifications_outbox where event_type = 'promotion_alert' and payload ->> 'change' = 'used' and payload ->> 'code' = 'TEN64'),
  'payment approved: "code used" alert with User ID, order, original price, discount and price paid');

-- Excel copies: queued with the file (server only)
select pg_temp.login(:super);
select pg_temp.throws($$select public.queue_excel_copy('11111111-1111-1111-1111-111111111111.xlsx', 'a.xlsx', 'Orders', 1, null)$$, '%permission denied%',
  'staff cannot queue Excel copies themselves');
reset role;
set role service_role;
select public.queue_excel_copy('11111111-1111-1111-1111-111111111111.xlsx', 'orders-2026-11-01_to_2026-11-23.xlsx', 'Orders', 12, :super);
select pg_temp.throws($$select public.queue_excel_copy('../x.xlsx', 'a.xlsx', 'Orders', 1, null)$$, 'invalid_request', 'only a stored export file');
reset role;
select pg_temp.ok((select attachment_bucket = 'excel-exports' and payload ->> 'rows' = '12' and payload ->> 'by_user_id' = (select member_id::text from public.customer_accounts where id = :super)
                   from public.notifications_outbox where event_type = 'excel_export'), 'Excel copy queued with the file, rows and who downloaded it');
select pg_temp.ok((select public from storage.buckets where id = 'excel-exports') = false, 'the Excel bucket is private');
rollback;
