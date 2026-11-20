-- Promotion codes at checkout, analytics, orphaned uploads
\ir _helpers.sql

insert into public.promotions (title_en, title_am, code, discount_type, discount_value, min_order_etb, category_id, product_id,
                               max_redemptions, once_per_customer, show_on_homepage, is_active, ends_at) values
  ('Ten off', 'አስር', 'SAVE10', 'percent', 10, 0, null, null, null, true, true, true, null),
  ('Electronics 500', 'ኤሌክትሮኒክስ', 'ELEC500', 'fixed', 500, 0, '10000000-0000-0000-0000-000000000002', null, null, false, false, true, null),
  ('Perfume only', 'ሽቶ', 'PERFUME', 'percent', 20, 0, null, '20000000-0000-0000-0000-000000000001', null, false, false, true, null),
  ('Big orders', 'ትልቅ', 'MIN5000', 'percent', 5, 5000, null, null, null, false, false, true, null),
  ('Only one', 'አንድ', 'LIMIT1', 'percent', 5, 0, null, null, 1, false, false, true, null),
  ('Huge', 'ትልቅ ቅናሽ', 'HUGE', 'fixed', 10000, 0, null, null, null, false, false, true, null),
  ('Old', 'የድሮ', 'OLDCODE', 'percent', 5, 0, null, null, null, false, false, true, now() - interval '1 day'),
  ('Off', 'ጠፍቷል', 'OFFCODE', 'percent', 5, 0, null, null, null, false, false, false, null);

create function pg_temp.buy(p_user uuid, p_code text, p_items jsonb) returns jsonb language sql as $$
  select public.create_order_for_user(p_user,
    pg_temp.order_payload(gen_random_uuid(), p_items, 'pickup') || jsonb_build_object('promotion_code', p_code))
$$;
create function pg_temp.items(p_product uuid, p_qty integer) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', p_product, 'quantity', p_qty)) $$;
\set charger_items 'pg_temp.items(''20000000-0000-0000-0000-000000000007'', 2)'

set role service_role;
-- percent, case-insensitive, total recomputed in the database
create temp table t1 as select pg_temp.buy(:customer, ' save10 ', :charger_items) as r;
select pg_temp.ok((select (r ->> 'discount_etb')::numeric = 170 and (r ->> 'total_etb')::numeric = 1530 from t1), 'percent code: 10% of 1700');
select pg_temp.ok((select subtotal_etb = 1700 and discount_etb = 170 and total_etb = 1530 and promotion_id is not null
                     from public.orders where id = (select (r ->> 'order_id')::uuid from t1)), 'order stores discount and promotion');
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000001', 'SAVE10', pg_temp.items('20000000-0000-0000-0000-000000000007', 1))$$,
  'promo_already_used', 'once per customer');
update public.orders set status = 'cancelled' where id = (select (r ->> 'order_id')::uuid from t1);
select pg_temp.ok((select (pg_temp.buy(:customer, 'SAVE10', pg_temp.items('20000000-0000-0000-0000-000000000007', 1)) ->> 'discount_etb')::numeric = 85),
  'a cancelled order does not use up the code');

-- category scope (incl. subcategories) and product scope
select pg_temp.ok((select (pg_temp.buy(:customer, 'ELEC500', pg_temp.items('20000000-0000-0000-0000-000000000007', 1)
   || pg_temp.items('20000000-0000-0000-0000-000000000001', 1)) ->> 'discount_etb')::numeric = 500),
  'category code discounts only electronics (fixed 500)');
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000001', 'PERFUME', pg_temp.items('20000000-0000-0000-0000-000000000007', 1))$$,
  'promo_not_applicable', 'product code does not apply to other products');
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000001', 'MIN5000', pg_temp.items('20000000-0000-0000-0000-000000000007', 1))$$,
  'promo_min_order', 'minimum order amount');
select pg_temp.ok((select (pg_temp.buy(:customer, 'LIMIT1', pg_temp.items('20000000-0000-0000-0000-000000000007', 1)) ->> 'discount_etb')::numeric > 0), 'limited code: first use');
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000002', 'LIMIT1', pg_temp.items('20000000-0000-0000-0000-000000000007', 1))$$,
  'promo_limit_reached', 'limited code: usage limit');
select pg_temp.ok((select (pg_temp.buy(:customer, 'HUGE', pg_temp.items('20000000-0000-0000-0000-000000000007', 1)) ->> 'total_etb')::numeric = 1),
  'a discount never makes an order free');
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000001', 'OLDCODE', pg_temp.items('20000000-0000-0000-0000-000000000007', 1))$$,
  'invalid_promo_code', 'expired code');
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000001', 'OFFCODE', pg_temp.items('20000000-0000-0000-0000-000000000007', 1))$$,
  'invalid_promo_code', 'inactive code');
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000001', 'x'' or 1=1', pg_temp.items('20000000-0000-0000-0000-000000000007', 1))$$,
  'invalid_promo_code', 'malformed code');
select pg_temp.ok((select (public.quote_promotion('save10', pg_temp.items('20000000-0000-0000-0000-000000000007', 3), :customer2) ->> 'discount_etb')::numeric = 255),
  'checkout preview uses database prices');
select pg_temp.ok((select (public.create_order_for_user(:customer2, pg_temp.order_payload(gen_random_uuid(),
   pg_temp.items('20000000-0000-0000-0000-000000000007', 1), 'pickup')) ->> 'discount_etb')::numeric = 0), 'no code, no discount');
reset role;

select pg_temp.login(:customer);
select pg_temp.throws($$select public.quote_promotion('SAVE10', '[]', 'cccccccc-0000-0000-0000-000000000001')$$, '%permission denied%',
  'customers cannot call the preview directly (rate-limited server only)');
reset role;
set role anon;
select pg_temp.ok((select count(*) from public.promotions where code = 'SAVE10') = 1, 'homepage promotions are public');
select pg_temp.ok((select count(*) from public.promotions where code <> 'SAVE10') = 0, 'other codes cannot be listed');
reset role;

-- ---------------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------------
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now()
 where id = (select id from public.orders where user_id = :customer2 order by created_at desc limit 1);
select pg_temp.login(:super);
create temp table t_a as select public.admin_analytics((now() at time zone 'Africa/Addis_Ababa')::date - 7, (now() at time zone 'Africa/Addis_Ababa')::date + 1, 'day') as a;
select pg_temp.ok((select (a #>> '{totals,revenue}')::numeric >= 850 and (a ->> 'money')::boolean from t_a), 'super admin sees revenue');
select pg_temp.ok((select jsonb_array_length(a -> 'series') = 9 from t_a), 'one point per day');
select pg_temp.ok((select (a #>> '{best_sellers,0,qty}')::int >= 1 from t_a), 'best sellers');
select pg_temp.ok((select (a #>> '{totals,orders_placed}')::int >= 6 from t_a), 'orders placed counted');
select pg_temp.ok((select (a -> 'promotions') @> '[{"code":"SAVE10"}]' from t_a), 'promotion usage');
select pg_temp.ok((select jsonb_array_length(public.admin_analytics((now() at time zone 'Africa/Addis_Ababa')::date - 90, (now() at time zone 'Africa/Addis_Ababa')::date, 'month') -> 'series') between 3 and 5),
  'monthly buckets');
select pg_temp.throws($$select public.admin_analytics((now() at time zone 'Africa/Addis_Ababa')::date, (now() at time zone 'Africa/Addis_Ababa')::date - 1)$$, 'invalid_request', 'invalid range');
reset role;
select pg_temp.login(:manager);
create temp table t_m as select public.admin_analytics((now() at time zone 'Africa/Addis_Ababa')::date - 7, (now() at time zone 'Africa/Addis_Ababa')::date, 'week') as a;
select pg_temp.ok((select a #> '{totals,revenue}' = 'null'::jsonb and a #> '{inventory,stock_value}' = 'null'::jsonb
                     and (a #>> '{totals,orders_placed}')::int >= 1 from t_m), 'managers see counts but no money');
reset role;
select pg_temp.login(:staff);
select pg_temp.throws($$select public.admin_analytics((now() at time zone 'Africa/Addis_Ababa')::date - 7, (now() at time zone 'Africa/Addis_Ababa')::date)$$, 'forbidden', 'staff cannot see analytics');
reset role;

-- ---------------------------------------------------------------------------
-- Orphaned uploads
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, created_at) values
  ('payment-receipts', 'orders/x/orphan.png', now() - interval '2 days'),
  ('payment-receipts', 'orders/x/fresh.png', now()),
  ('printing-files', 'jobs/x/orphan.pdf', now() - interval '2 days'),
  ('product-images', 'products/x/keep.png', now() - interval '2 days');
set role service_role;
create temp table t_o as select * from public.storage_orphans();
select pg_temp.ok((select count(*) from t_o where name in ('orders/x/orphan.png', 'jobs/x/orphan.pdf')) = 2, 'old unattached customer uploads are found');
select pg_temp.ok((select count(*) from t_o where name in ('orders/x/fresh.png', 'products/x/keep.png')) = 0, 'recent uploads and other buckets are left alone');
select pg_temp.ok((select count(*) from public.storage_orphans(interval '1 minute') where name = 'orders/x/fresh.png') = 0, 'minimum age is at least 6 hours');
reset role;
select pg_temp.login(:super);
select pg_temp.throws($$select * from public.storage_orphans()$$, '%permission denied%', 'only the server can list orphans');
reset role;
rollback;
