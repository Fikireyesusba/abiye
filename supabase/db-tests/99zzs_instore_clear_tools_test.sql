-- In-store sales; clear activity / notifications after exporting; clear the reviewed list
\ir _helpers.sql
select (select stock_quantity from public.products where id = :charger) as stock0 \gset

-- in-store sale (manager has orders.manage)
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_create_instore_sale(%L, 'cash')$$, jsonb_build_array(jsonb_build_object('product_id', :charger, 'quantity', 1))), 'forbidden', 'staff without orders.manage cannot');
reset role;
-- the online shop being paused does not stop the counter
update public.website_settings set value = value || '{"shop": false}' where key = 'services';
select pg_temp.login(:manager);
create temp table t_sale as select public.admin_create_instore_sale(jsonb_build_array(jsonb_build_object('product_id', :charger, 'quantity', 2)), 'cash',
  null, null, 50, 'Paid at the counter', 'ee000000-0000-0000-0000-000000000001') as r;
reset role;
select pg_temp.ok((select o.channel = 'in_store' and o.status = 'completed' and o.payment_status = 'verified' and o.payment_method = 'cash'
                     and o.customer_name = 'Walk-in customer' and o.user_id is null and o.total_etb = o.subtotal_etb - 50
                   from public.orders o where o.id = (select (r ->> 'order_id')::uuid from t_sale)), 'recorded as a paid, completed in-store order (discount applied)');
select pg_temp.ok((select stock_quantity from public.products where id = :charger) = :stock0 - 2, 'stock taken');
select pg_temp.login(:manager);
select pg_temp.ok((public.admin_create_instore_sale(jsonb_build_array(jsonb_build_object('product_id', :charger, 'quantity', 2)), 'cash',
  null, null, 50, null, 'ee000000-0000-0000-0000-000000000001') ->> 'replayed')::boolean, 'same sale sent twice is recorded once');
select pg_temp.throws(format($$select public.admin_create_instore_sale(%L, 'cash')$$, jsonb_build_array(jsonb_build_object('product_id', :charger, 'quantity', 100000))), 'invalid_quantity', 'quantity checked');
select pg_temp.throws(format($$select public.admin_create_instore_sale(%L, 'card')$$, jsonb_build_array(jsonb_build_object('product_id', :charger, 'quantity', 1))), 'invalid_request', 'payment method checked');
select pg_temp.throws(format($$select public.admin_create_instore_sale(%L, 'cash', 'Abebe', '0911')$$, jsonb_build_array(jsonb_build_object('product_id', :charger, 'quantity', 1))), 'invalid_phone', 'phone checked');
select public.admin_void_instore_sale((select (r ->> 'order_id')::uuid from t_sale), 'Customer returned it');
reset role;
update public.website_settings set value = value || '{"shop": true}' where key = 'services';
select pg_temp.ok((select stock_quantity from public.products where id = :charger) = :stock0, 'voided: stock back');
select pg_temp.ok((select status = 'cancelled' and payment_status = 'refunded' from public.orders where id = (select (r ->> 'order_id')::uuid from t_sale)), 'voided: cancelled and refunded');

-- activity log: clear a range only after exporting it
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_clear_audit_range(current_date - 3, current_date)$$, 'invalid_request', 'not exported yet: refused');
select public.admin_log_export('activity', jsonb_build_object('from', (current_date - 10)::text, 'to', (now() at time zone 'Europe/Warsaw')::date::text, 'type', 'all', 'rows', 5));
select pg_temp.ok(public.admin_clear_audit_range(current_date - 3, (now() at time zone 'Europe/Warsaw')::date) >= 1, 'exported range cleared');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'audit_cleared' and metadata ? 'from'), 'the clearing is recorded');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'export_activity'), 'the export record is kept');
select pg_temp.throws($$select public.admin_clear_audit_range(current_date - 30, current_date)$$, 'invalid_request', 'a wider range than exported: refused');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_clear_audit_range(current_date, current_date)$$, 'forbidden', 'managers cannot clear');
reset role;

-- notifications: same rule; waiting messages are kept
insert into public.notifications_outbox (event_type, dedupe_key, payload, status, sent_at) values ('test_message', 'clr:1', '{}', 'sent', now());
insert into public.notifications_outbox (event_type, dedupe_key, payload, status) values ('test_message', 'clr:2', '{}', 'pending');
select pg_temp.login(:super);
select pg_temp.ok((select count(*) from public.admin_notifications_export(current_date - 1, (now() at time zone 'Europe/Warsaw')::date)) >= 2, 'export rows');
select pg_temp.throws($$select public.admin_clear_notifications(current_date - 1, current_date)$$, 'invalid_request', 'not exported: refused');
select public.admin_log_export('notifications', jsonb_build_object('from', (current_date - 1)::text, 'to', (now() at time zone 'Europe/Warsaw')::date::text));
select public.admin_clear_notifications(current_date - 1, (now() at time zone 'Europe/Warsaw')::date);
reset role;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where dedupe_key = 'clr:1') and exists (select 1 from public.notifications_outbox where dedupe_key = 'clr:2'),
  'sent messages cleared, waiting ones kept');

-- reviewed list
select pg_temp.login(:super);
select public.admin_mark_security_reviewed('email', array['seen@example.com'], 'ok');
select public.admin_mark_security_reviewed('email', array['other@example.com'], 'ok');
select pg_temp.ok(public.admin_clear_reviewed_list('email', 'seen@example.com') = 1, 'one entry cleared from the list');
select pg_temp.ok(not exists (select 1 from public.admin_security_reviews(200) where subject = 'seen@example.com')
  and exists (select 1 from public.admin_security_reviews(200) where subject = 'other@example.com'), 'only that one leaves the list');
reset role;
select pg_temp.ok(private.reviewed_at('email', 'seen@example.com') is not null, 'the review still counts (no alert comes back)');
select pg_temp.login(:super);
select public.admin_clear_reviewed_list();
select pg_temp.ok(not exists (select 1 from public.admin_security_reviews(200)), 'whole list cleared');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_clear_reviewed_list()$$, 'forbidden', 'needs security.manage');
reset role;
