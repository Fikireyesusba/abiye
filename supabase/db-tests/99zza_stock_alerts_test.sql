-- Low-stock / sold-out staff alerts; customers notified when back in stock
\ir _helpers.sql

-- staff alert recipients: active staff whose role manages inventory
select pg_temp.ok((select count(*) from private.stock_alert_recipients()) >= 1, 'stock managers receive stock emails');
select pg_temp.ok(not exists (select 1 from private.stock_alert_recipients() r where r = :staff), 'staff without inventory permission do not');

-- charger: threshold 5
update public.products set stock_quantity = 20, low_stock_threshold = 5 where id = :charger;
delete from public.notifications_outbox;
update public.products set stock_quantity = 9 where id = :charger;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox), 'no alert above the level');
update public.products set stock_quantity = 5 where id = :charger;
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'telegram' and event_type = 'low_stock') = 1, 'Telegram alert at the low-stock level');
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'email' and event_type = 'staff_low_stock') >= 1
                  and (select payload ->> 'stock' from public.notifications_outbox where event_type = 'low_stock') = '5', 'staff email with the stock left');
update public.products set stock_quantity = 3 where id = :charger;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'low_stock') = 1, 'not repeated while already low');

-- customer asks to be told; only when sold out
select pg_temp.login(:customer);
select pg_temp.throws(format($$select public.request_stock_alert(%L)$$, :charger), 'invalid_request', 'cannot ask while in stock');
reset role;
update public.products set stock_quantity = 0 where id = :charger;
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'telegram' and event_type = 'out_of_stock') = 1, 'sold-out alert');
select pg_temp.login(:customer);
select public.request_stock_alert(:charger);
select public.request_stock_alert(:charger);
select pg_temp.ok((select count(*) from public.stock_alerts where product_id = :charger) = 1, 'asking twice keeps one request');
reset role;
select pg_temp.login(:customer2);
select public.request_stock_alert(:charger);
select public.cancel_stock_alert(:charger);
select pg_temp.ok(not exists (select 1 from public.stock_alerts where user_id = :customer2), 'a customer can cancel');
select pg_temp.ok((select count(*) from public.stock_alerts) = 0, 'customers only see their own requests');
reset role;
update auth.users set email_confirmed_at = now() where id = :staff;
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.request_stock_alert(%L)$$, :charger), 'staff_account', 'staff cannot use it');
reset role;
set role anon;
select pg_temp.throws(format($$select public.request_stock_alert(%L)$$, :charger), '%permission denied%', 'visitors must sign in');
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.stock_alerts where product_id = :charger) = 1, 'stock managers see how many are waiting');
select pg_temp.ok(public.admin_low_stock_count() >= 1, 'low-stock count for the admin badge');
reset role;
select pg_temp.login(:staff);
select pg_temp.ok(public.admin_low_stock_count() = 0, 'no count for staff without inventory permission');
reset role;

-- back in stock → customer email (+ push only with a device), request closed
update public.products set stock_quantity = 12 where id = :charger;
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'email' and event_type = 'customer_back_in_stock' and recipient_user_id = :customer) = 1,
                  'customer emailed when back in stock');
select pg_temp.ok((select notified_at is not null from public.stock_alerts where user_id = :customer and product_id = :charger), 'request closed');
update public.products set stock_quantity = 0 where id = :charger;
update public.products set stock_quantity = 4 where id = :charger;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'customer_back_in_stock') = 1, 'told only once');
-- untracked / inactive products: no alerts
delete from public.notifications_outbox;
update public.products set track_inventory = false where id = :perfume;
update public.products set stock_quantity = 0 where id = :perfume;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox), 'no alerts for products without stock tracking');
