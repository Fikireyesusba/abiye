-- Product reviews: verified purchases only, moderation, public sees safe fields, product rating
\ir _helpers.sql
update auth.users set email_confirmed_at = now() where id in (:customer, :customer2);
update public.customer_accounts set full_name = 'Mekdes  Alemu Bekele' where id = :customer;

-- customer 1 has a COMPLETED order with the charger; customer 2 only a pending one
select public.create_order_for_user(:customer, pg_temp.order_payload('d1000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
select public.create_order_for_user(:customer2, pg_temp.order_payload('d1000000-0000-0000-0000-000000000002', jsonb_build_array(
  jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))));
update public.orders set status = 'completed' where idempotency_key = 'd1000000-0000-0000-0000-000000000001';

select pg_temp.login(:customer2);
select pg_temp.ok((public.my_product_review(:charger) ->> 'eligible')::boolean = false, 'not eligible before receiving the product');
select pg_temp.throws(format($$select public.submit_product_review(%L, 5, 'great')$$, :charger), 'forbidden', 'cannot review without a completed order');
reset role;

select pg_temp.login(:customer);
select pg_temp.ok((public.my_product_review(:charger) ->> 'eligible')::boolean, 'eligible after a completed order');
select pg_temp.throws(format($$select public.submit_product_review(%L, 6, null)$$, :charger), 'invalid_request', 'rating 1–5');
select pg_temp.throws(format($$select public.submit_product_review(%L, 5, %L)$$, :charger, repeat('x', 1001)), 'invalid_request', 'comment up to 1000 characters');
select public.submit_product_review(:charger, 4, '  Charges fast.  ');
select pg_temp.ok((public.my_product_review(:charger) -> 'review' ->> 'status') = 'pending', 'new review waits for approval');
select pg_temp.ok(not exists (select 1 from public.product_reviews where product_id = :charger), 'not public while pending');
reset role;
select pg_temp.ok((select display_name = 'Mekdes A.' and body = 'Charges fast.' and order_id is not null from public.product_reviews where user_id = :customer),
                  'shown as first name + initial, comment trimmed, linked to the order');

-- moderation
select pg_temp.login(:staff);
select pg_temp.throws($$select * from public.admin_product_reviews('pending')$$, 'forbidden', 'staff cannot moderate');
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.admin_product_reviews('pending')) = 1, 'manager sees the pending review');
select pg_temp.throws(format($$select public.admin_moderate_review(%L, 'maybe')$$, (select id from public.admin_product_reviews('pending') limit 1)),
                      'invalid_decision', 'decision must be approve or reject');
select public.admin_moderate_review((select id from public.admin_product_reviews('pending') limit 1), 'approved');
reset role;
select pg_temp.ok((select rating_avg = 4.0 and rating_count = 1 from public.products where id = :charger), 'product rating updated');
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'review_approved'), 'decision recorded');

-- public view: approved only, safe columns only
set role anon;
select pg_temp.ok((select count(*) from public.product_reviews where product_id = :charger) = 1, 'visitors see the approved review');
select pg_temp.throws($$select user_id from public.product_reviews$$, '%permission denied%', 'visitors cannot see who wrote it');
select pg_temp.throws($$select order_id from public.product_reviews$$, '%permission denied%', 'or the order');
select pg_temp.ok((select rating_avg = 4.0 from public.products where id = 'cccccccc-0000-0000-0000-000000000001'::uuid or id = :charger), 'visitors see the product rating');
reset role;

-- editing sends it back for approval; rating follows approved reviews only
select pg_temp.login(:customer);
select public.submit_product_review(:charger, 2, 'Stopped working.');
reset role;
select pg_temp.ok((select status from public.product_reviews where user_id = :customer) = 'pending', 'edited review is checked again');
select pg_temp.ok((select rating_avg is null and rating_count = 0 from public.products where id = :charger), 'rating ignores reviews waiting for approval');
select pg_temp.login(:manager);
select public.admin_moderate_review((select id from public.admin_product_reviews('pending') limit 1), 'rejected', 'Please contact us for warranty');
reset role;
select pg_temp.login(:customer);
select pg_temp.ok((public.my_product_review(:charger) -> 'review' ->> 'note') = 'Please contact us for warranty', 'customer sees why it was not published');
select public.delete_my_product_review(:charger);
reset role;
select pg_temp.ok(not exists (select 1 from public.product_reviews where user_id = :customer), 'customer can delete their review');
-- direct writes are refused
select pg_temp.login(:customer);
select pg_temp.throws(format($$insert into public.product_reviews (product_id, user_id, rating, display_name, status) values (%L, %L, 5, 'X', 'approved')$$, :charger, :customer),
                      '%permission denied%', 'no direct inserts (cannot self-approve)');
reset role;
