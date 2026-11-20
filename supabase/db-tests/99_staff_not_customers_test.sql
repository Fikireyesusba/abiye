-- Staff accounts cannot order as customers
\ir _helpers.sql
update auth.users set email_confirmed_at = now() where id = :staff;
set role service_role;
select pg_temp.throws($$select public.create_order_for_user('aaaaaaaa-0000-0000-0000-000000000003', pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))$$,
  'staff_account', 'staff accounts cannot place orders');
select pg_temp.ok((public.create_order_for_user(:customer, pg_temp.order_payload(gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1)))) ->> 'order_id') is not null,
  'customers still can');
reset role;
rollback;
