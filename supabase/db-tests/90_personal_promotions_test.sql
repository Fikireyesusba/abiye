-- Personal promo codes (only for chosen customer accounts)
\ir _helpers.sql

insert into public.promotions (id, title_en, title_am, code, discount_type, discount_value, restricted, once_per_customer)
values ('90000000-0000-0000-0000-000000000001', 'VIP', 'ቪአይፒ', 'VIPONLY', 'percent', 20, true, true),
       ('90000000-0000-0000-0000-000000000002', 'Public', 'ህዝብ', 'EVERYONE', 'percent', 5, false, false);

create function pg_temp.buy(p_user uuid, p_code text) returns jsonb language sql as $$
  select public.create_order_for_user(p_user, pg_temp.order_payload(gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')
    || jsonb_build_object('promotion_code', p_code)) $$;

select pg_temp.throws($$update public.promotions set show_on_homepage = true where code = 'VIPONLY'$$,
  '%promotions_personal_not_public%', 'personal promotions cannot be shown on the homepage');

-- Assigning
select pg_temp.login(:staff);
select pg_temp.throws($$select public.admin_assign_promotion('90000000-0000-0000-0000-000000000001', array['customer@test.local'])$$,
  'forbidden', 'staff cannot give promo codes');
reset role;
select pg_temp.login(:customer);
select pg_temp.throws($$insert into public.promotion_customers (promotion_id, user_id) values ('90000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001')$$,
  '%permission denied%', 'customers cannot give themselves a code');
reset role;
select pg_temp.login(:manager);
create temp table t_as as select public.admin_assign_promotion('90000000-0000-0000-0000-000000000001',
  array[' Customer@Test.local ', 'nobody@test.local', 'customer@test.local']) as r;
select pg_temp.ok((select r -> 'added' = '["customer@test.local"]' and r -> 'already' = '["customer@test.local"]'
                     and r -> 'not_found' = '["nobody@test.local"]' from t_as), 'emails resolved (case-insensitive), duplicates and unknowns reported');
select pg_temp.throws($$select public.admin_assign_promotion('90000000-0000-0000-0000-000000000002', array['customer@test.local'])$$,
  'invalid_request', 'only personal promotions take a customer list');
select pg_temp.ok((select count(*) from public.admin_promotion_customers('90000000-0000-0000-0000-000000000001') where email = 'customer@test.local' and not used) = 1,
  'admin sees who holds the code');
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'promo_assigned' and entity_id = :customer::text and metadata ->> 'code' = 'VIPONLY') = 1,
  'giving a code is audited on the customer');

-- Customer view
select pg_temp.login(:customer);
select pg_temp.ok((select code from public.my_offers()) = 'VIPONLY', 'customer sees their personal code');
select pg_temp.ok((select count(*) from public.promotions where code = 'VIPONLY') = 0, 'personal promotions are not readable directly');
select pg_temp.ok((select count(*) from public.promotion_customers) = 0, 'customers cannot read the assignment table');
reset role;
select pg_temp.login(:customer2);
select pg_temp.ok((select count(*) from public.my_offers()) = 0, 'other customers see nothing');
reset role;
set role anon;
select pg_temp.ok((select count(*) from public.promotions where code = 'VIPONLY') = 0, 'anon cannot see personal promotions');
reset role;

-- Redeeming
set role service_role;
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000002', 'VIPONLY')$$, 'invalid_promo_code',
  'another customer cannot use a personal code');
select pg_temp.throws($$select public.quote_promotion('VIPONLY', jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)), 'cccccccc-0000-0000-0000-000000000002')$$,
  'invalid_promo_code', 'preview refuses other customers too');
select pg_temp.ok((select (pg_temp.buy(:customer, 'viponly') ->> 'discount_etb')::numeric = 170), 'the chosen customer gets the discount');
select pg_temp.ok((select (pg_temp.buy(:customer2, 'EVERYONE') ->> 'discount_etb')::numeric > 0), 'public codes are unaffected');
reset role;
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.my_offers()) = 0, 'a used once-per-customer code disappears from the offers');
reset role;

-- Removing
select pg_temp.login(:manager);
delete from public.promotion_customers where promotion_id = '90000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select count(*) from public.audit_logs where action = 'promo_unassigned' and entity_id = :customer::text) = 1, 'removing a code is audited');
rollback;
