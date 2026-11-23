-- Promotion rules (0062): once per customer, used on payment approval, revoke with a reason,
-- remove from customers with a reason, delete (Super Admin only, unused, nobody holds it).
\ir _helpers.sql

insert into public.promotions (id, title_en, title_am, code, discount_type, discount_value, restricted, once_per_customer)
values ('62000000-0000-0000-0000-000000000001', 'Gift', 'Gift', 'GIFT62', 'percent', 10, true, false),
       ('62000000-0000-0000-0000-000000000002', 'All', 'All', 'ALL62', 'percent', 5, false, false),
       ('62000000-0000-0000-0000-000000000003', 'Spare', 'Spare', 'SPARE62', 'fixed', 50, false, true);

create function pg_temp.buy(p_user uuid, p_code text) returns jsonb language sql as $$
  select public.create_order_for_user(p_user, pg_temp.order_payload(gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1)), 'pickup')
    || jsonb_build_object('promotion_code', p_code)) $$;

select pg_temp.ok((select bool_and(once_per_customer) from public.promotions where id::text like '62000000%'), 'every promotion is once per customer');

-- Given by User ID
select pg_temp.login(:manager);
create temp table t_as as select public.admin_assign_promotion('62000000-0000-0000-0000-000000000001',
  array[(select member_id::text from public.customer_accounts where id = :customer)]) as r;
select pg_temp.ok((select jsonb_array_length(r -> 'added') = 1 from t_as), 'a personal code can be given by User ID');
select pg_temp.throws($$update public.promotions set restricted = false where id = '62000000-0000-0000-0000-000000000001'$$,
  'promo_has_customers', 'a personal code given to customers cannot be made public');
reset role;

-- Everyone code: once per customer
set role service_role;
create temp table t_o1 as select pg_temp.buy(:customer2, 'ALL62') as r;
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000002', 'ALL62')$$, 'promo_already_used', 'a code for everyone: once per customer');
-- Personal code: reserved while waiting for payment, used once the payment is approved
create temp table t_o2 as select pg_temp.buy(:customer, 'GIFT62') as r;
reset role;
select pg_temp.login(:manager);
select pg_temp.ok((select reserved and not used from public.admin_promotion_customers('62000000-0000-0000-0000-000000000001')), 'waiting for payment: reserved, not used yet');
reset role;
update public.orders set payment_status = 'verified', payment_verified_at = now(), status = 'confirmed'
 where id = (select (r ->> 'order_id')::uuid from t_o2);
select pg_temp.login(:manager);
select pg_temp.ok((select used and not reserved and used_order_number is not null from public.admin_promotion_customers('62000000-0000-0000-0000-000000000001')),
  'payment approved: the code is marked used, with the order');
select pg_temp.throws($$select public.admin_unassign_promotion('62000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Changed my mind')$$,
  'promo_in_use', 'a used code stays with the customer');
reset role;
select pg_temp.login(:customer);
select pg_temp.ok((select count(*) from public.my_offers()) = 0, 'a used code disappears from the customer''s account');
reset role;

-- Revoke with a reason
select pg_temp.login(:staff);
select pg_temp.throws($$select public.admin_revoke_promotion('62000000-0000-0000-0000-000000000002', 'Ended early')$$, 'forbidden', 'staff cannot revoke');
reset role;
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_revoke_promotion('62000000-0000-0000-0000-000000000002', 'x')$$, 'invalid_reason', 'revoking needs a reason');
select public.admin_revoke_promotion('62000000-0000-0000-0000-000000000002', 'Ended early');
select pg_temp.throws($$select public.admin_revoke_promotion('62000000-0000-0000-0000-000000000002', 'Ended early')$$, 'invalid_transition', 'cannot revoke twice');
select pg_temp.throws($$update public.promotions set is_active = true where id = '62000000-0000-0000-0000-000000000002'$$, 'forbidden',
  'only the Super Admin can bring a revoked promotion back');
update public.promotions set revoked_at = null, revoked_reason = null where id = '62000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.ok((select not is_active and revoked_reason = 'Ended early' and revoked_by = :manager from public.promotions where id = '62000000-0000-0000-0000-000000000002'),
  'revoked: off, with the reason and who (cannot be cleared by editing)');
select pg_temp.ok((select count(*) from public.audit_logs where action = 'promo_revoked' and metadata ->> 'reason' = 'Ended early') = 1, 'revoking is audited with the reason');
set role service_role;
select pg_temp.throws($$select pg_temp.buy('cccccccc-0000-0000-0000-000000000001', 'ALL62')$$, 'invalid_promo_code', 'a revoked code no longer works');
reset role;
select pg_temp.login(:super);
update public.promotions set is_active = true where id = '62000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.ok((select is_active and revoked_at is null from public.promotions where id = '62000000-0000-0000-0000-000000000002'), 'the Super Admin can bring it back');

-- Delete: Super Admin only, unused, nobody holds it
select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_delete_promotion('62000000-0000-0000-0000-000000000003')$$, 'forbidden', 'managers cannot delete promotions');
select pg_temp.throws($$delete from public.promotions where id = '62000000-0000-0000-0000-000000000003'$$, '%permission denied%', 'no direct deletes');
reset role;
select pg_temp.login(:super, 'aal1');
select pg_temp.throws($$select public.admin_delete_promotion('62000000-0000-0000-0000-000000000003')$$, 'forbidden', 'not without the two-step code');
reset role;
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_delete_promotion('62000000-0000-0000-0000-000000000002')$$, 'promo_in_use', 'a used promotion cannot be deleted');
select pg_temp.throws($$select public.admin_delete_promotion('62000000-0000-0000-0000-000000000001')$$, 'promo_in_use', 'a used personal promotion cannot be deleted');
reset role;
-- A personal promotion given to someone but never used: remove it from them first
insert into public.promotions (id, title_en, title_am, code, discount_type, discount_value, restricted)
values ('62000000-0000-0000-0000-000000000004', 'Unused', 'Unused', 'UNUSED62', 'percent', 10, true);
insert into public.promotion_customers (promotion_id, user_id) values ('62000000-0000-0000-0000-000000000004', :customer2);
-- an expired order with the code does not count as a use
set role service_role;
create temp table t_o3 as select pg_temp.buy(:customer2, 'UNUSED62') as r;
reset role;
update public.orders set status = 'expired' where id = (select (r ->> 'order_id')::uuid from t_o3);
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_delete_promotion('62000000-0000-0000-0000-000000000004')$$, 'promo_has_customers', 'given to a customer: remove it first');
select public.admin_unassign_promotion('62000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000002', 'Promotion withdrawn');
select public.admin_delete_promotion('62000000-0000-0000-0000-000000000004');
select public.admin_delete_promotion('62000000-0000-0000-0000-000000000003');
reset role;
select pg_temp.ok((select count(*) from public.promotions where id in ('62000000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000004')) = 0,
  'unused promotions deleted by the Super Admin (old expired orders keep their amounts)');
select pg_temp.ok((select promotion_id is null from public.orders where id = (select (r ->> 'order_id')::uuid from t_o3)), 'the expired order no longer points to it');
rollback;
