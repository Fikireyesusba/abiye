-- Personal discount codes are sent to the customer; create & send in one step
\ir _helpers.sql
update auth.users set email_confirmed_at = now() where id in (:customer, :customer2, :staff);
update public.customer_accounts set full_name = 'Mekdes Alemu' where id = :customer;
delete from public.notifications_outbox;

-- create & send
select pg_temp.login(:staff);
select pg_temp.throws(format($$select public.admin_create_personal_code(%L, 'percent', 10)$$, :customer), 'forbidden', 'staff without promotions cannot');
reset role;
select pg_temp.login(:super);
select pg_temp.throws(format($$select public.admin_create_personal_code(%L, 'percent', 95)$$, :customer), 'invalid_amount', 'percent up to 90');
select pg_temp.throws(format($$select public.admin_create_personal_code(%L, 'fixed', 100, 0, 400)$$, :customer), 'invalid_request', 'valid 1–365 days');
select pg_temp.throws(format($$select public.admin_create_personal_code(%L, 'fixed', 100)$$, :staff), 'staff_account', 'not for staff accounts');
create temp table t_code as select public.admin_create_personal_code(:customer, 'fixed', 150, 1000, 14, 'Thank you for your loyalty!') as r;
reset role;
select pg_temp.ok((select r ->> 'code' ~ '^MEKDES-[A-HJ-NP-Z2-9]{4}$' from t_code), 'unique code from the first name');
select pg_temp.ok((select restricted and once_per_customer and max_redemptions = 1 and is_active and not show_on_homepage
                          and ends_at > now() + interval '13 days' and min_order_etb = 1000
                     from public.promotions where id = (select (r ->> 'promotion_id')::uuid from t_code)), 'one customer, one use, 14 days, minimum order');
select pg_temp.ok(exists (select 1 from public.promotion_customers where user_id = :customer and promotion_id = (select (r ->> 'promotion_id')::uuid from t_code)), 'given to the customer');
select pg_temp.ok((select payload ->> 'code' = (select r ->> 'code' from t_code) and payload ->> 'note' = 'Thank you for your loyalty!' and payload ->> 'discount_value' = '150.00'
                     from public.notifications_outbox where event_type = 'customer_promo_gift' and channel = 'email' and recipient_user_id = :customer),
                  'email queued with the code, discount and note');
select pg_temp.login(:customer);
select pg_temp.ok(exists (select 1 from public.my_offers() o where o.code = (select r ->> 'code' from t_code)), 'shows in My offers');
reset role;
select pg_temp.login(:customer2);
select pg_temp.ok(not exists (select 1 from public.my_offers() o where o.code = (select r ->> 'code' from t_code)), 'nobody else sees it');
reset role;

-- giving an existing personal promotion: notify on/off
insert into public.promotions (title_en, title_am, code, discount_type, discount_value, restricted, is_active)
values ('VIP', 'ቪአይፒ', 'VIPTEST', 'percent', 10, true, true);
select pg_temp.login(:super);
select public.admin_assign_promotion((select id from public.promotions where code = 'VIPTEST'), array['customer2@test.local'], false);
reset role;
select pg_temp.ok(not exists (select 1 from public.notifications_outbox where event_type = 'customer_promo_gift' and recipient_user_id = :customer2), 'no message when "notify" is off');
delete from public.promotion_customers where user_id = :customer2;
select pg_temp.login(:super);
select public.admin_assign_promotion((select id from public.promotions where code = 'VIPTEST'), array['customer2@test.local'], true, 'Welcome back');
select public.admin_assign_promotion((select id from public.promotions where code = 'VIPTEST'), array['customer2@test.local']);
reset role;
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'customer_promo_gift' and channel = 'email' and recipient_user_id = :customer2) = 1,
                  'message when notify is on, never twice');
