-- Payment-only alerts; customers' name / phone / email locked after they are set
\ir _helpers.sql
-- Telegram orders group: payments only
select private.enqueue_notification('order_status', 't:status', '{}'::jsonb);
select private.enqueue_notification('order_placed', 't:placed', '{}'::jsonb);
select private.enqueue_notification('order_cancelled', 't:cancel', '{}'::jsonb);
select private.enqueue_notification('payment_rejected', 't:rej', '{}'::jsonb);
select private.enqueue_notification('new_order', 't:new', '{}'::jsonb);
select private.enqueue_notification('payment_verified', 't:ver', '{}'::jsonb);
select private.enqueue_notification('wallet_topup', 't:top', '{}'::jsonb);
select pg_temp.ok((select count(*) from public.notifications_outbox where dedupe_key in ('t:status', 't:placed', 't:cancel', 't:rej')) = 0, 'no order steps, cancellations or rejections');
select pg_temp.ok((select count(*) from public.notifications_outbox where dedupe_key in ('t:new', 't:ver', 't:top')) = 3, 'receipts to approve and completed payments are sent');

-- Personal details
update public.customer_accounts set phone = null where id = :customer;
select pg_temp.login(:customer);
update public.customer_accounts set full_name = 'Someone Else', phone = '+251911000111' where id = :customer;
reset role;
select pg_temp.ok((select full_name from public.customer_accounts where id = :customer) = 'Test Customer', 'name cannot be changed once set');
select pg_temp.ok((select phone from public.customer_accounts where id = :customer) = '+251911000111', 'phone can be added the first time');
select pg_temp.login(:customer);
update public.customer_accounts set phone = '+251922000222', default_address = 'Bole, near the bank' where id = :customer;
reset role;
select pg_temp.ok((select phone from public.customer_accounts where id = :customer) = '+251911000111', 'phone cannot be changed afterwards');
select pg_temp.ok((select default_address from public.customer_accounts where id = :customer) = 'Bole, near the bank', 'delivery address stays editable');
select pg_temp.throws(format($$update auth.users set email_change = 'new@example.com' where id = %L$$, :customer), '%email_change_not_allowed%', 'email change requests are refused');
update auth.users set email = 'customer@test.local' where id = :customer;  -- staff path (direct)

select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_update_customer_details(%L, 'X Y', null)$$, :customer), 'forbidden', 'staff without customers.manage cannot');
reset role;
select pg_temp.login(:super);
select public.admin_update_customer_details(:customer, 'Corrected Name', '+251922000222');
select pg_temp.throws(format($$select public.admin_update_customer_details(%L, 'Corrected Name', '0911')$$, :customer), 'invalid_phone', 'phone checked');
select pg_temp.throws(format($$select public.admin_update_customer_details(%L, 'Staff Name', null)$$, :manager), 'invalid_request', 'not for staff accounts');
reset role;
select pg_temp.ok((select full_name || '|' || phone from public.customer_accounts where id = :customer) = 'Corrected Name|+251922000222', 'admin changed the details');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'profile_updated' and entity_id = :customer::text), 'change recorded');
