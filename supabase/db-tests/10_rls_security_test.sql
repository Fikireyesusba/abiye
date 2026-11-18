-- RLS, privileges and role-permission tests
\ir _helpers.sql

-- ---------------------------------------------------------------- anon
set role anon;
select pg_temp.ok((select count(*) from public.products) = 10, 'anon sees only active products (draft hidden)');
select pg_temp.ok(not exists (select 1 from public.products where id = :draft), 'anon cannot read draft product');
select pg_temp.throws('select low_stock_threshold from public.products', '%permission denied%',
  'anon cannot read internal product columns');
select pg_temp.throws('select * from public.orders', '%permission denied%', 'anon cannot read orders');
select pg_temp.throws('select * from public.customers', '%permission denied%', 'anon cannot read customers');
select pg_temp.throws('select * from public.bank_accounts', '%permission denied%', 'anon cannot read bank accounts table');
select pg_temp.throws('select * from public.payment_submissions', '%permission denied%', 'anon cannot read payments');
select pg_temp.throws('select * from public.notifications_outbox', '%permission denied%', 'anon cannot read outbox');
select pg_temp.throws('select * from public.audit_logs', '%permission denied%', 'anon cannot read audit log');
select pg_temp.throws('update public.products set price_etb = 1', '%permission denied%', 'anon cannot update products');
select pg_temp.throws($$select public.create_order('{}'::jsonb)$$, '%permission denied%', 'anon cannot call create_order directly');
select pg_temp.throws($$select public.submit_payment('{}'::jsonb)$$, '%permission denied%', 'anon cannot call submit_payment directly');
select pg_temp.throws($$select public.admin_review_payment(gen_random_uuid(), 'verified')$$, '%permission denied%', 'anon cannot call admin RPCs');
select pg_temp.throws($$select public.bootstrap_super_admin(gen_random_uuid(), 'x')$$, '%permission denied%', 'anon cannot bootstrap super admin');
select pg_temp.ok((select count(*) from public.website_settings) = 7, 'anon reads public website settings');
select pg_temp.ok((select count(*) from public.delivery_zones) = 4, 'anon reads active delivery zones');
select pg_temp.ok((select count(*) from storage.objects where bucket_id in ('payment-receipts','printing-files')) = 0,
  'anon sees no private storage objects');
reset role;

-- ------------------------------------------------- signed-up non-admin user
select pg_temp.login(:outsider);
select pg_temp.ok(public.my_admin_context() is null, 'non-admin user has no admin context');
select pg_temp.ok((select count(*) from public.orders) = 0, 'non-admin user sees no orders');
select pg_temp.ok((select count(*) from public.bank_accounts) = 0, 'non-admin user sees no bank accounts');
select pg_temp.ok(not exists (select 1 from public.products where id = :draft), 'non-admin user cannot see drafts');
select pg_temp.throws($$insert into public.categories (department, slug, name_en, name_am) values ('cosmetics','x','x','x')$$,
  '%row-level security%', 'non-admin user cannot create categories');
select pg_temp.throws($$select public.admin_adjust_stock('20000000-0000-0000-0000-000000000001', 5, 'restock')$$,
  'forbidden', 'non-admin user cannot adjust stock');
reset role;

-- ---------------------------------------------------------------- staff
select pg_temp.login(:staff);
select pg_temp.ok((public.my_admin_context() ->> 'role') = 'staff', 'staff admin context resolves');
select pg_temp.ok((select count(*) from public.bank_accounts) = 0, 'staff cannot read bank accounts');
select pg_temp.ok((select count(*) from public.customers) = 0, 'staff cannot browse customer directory');
update public.bank_accounts set account_number = '999999999' ;
reset role;
select pg_temp.ok((select count(*) from public.bank_accounts where account_number = '999999999') = 0,
  'staff update of bank accounts affects no rows');
select pg_temp.login(:staff);
select pg_temp.throws($$insert into public.bank_accounts (bank_name, account_holder, account_number) values ('Evil','Evil','123456789')$$,
  '%row-level security%', 'staff cannot add bank accounts');
select pg_temp.throws($$select public.admin_set_staff_role('aaaaaaaa-0000-0000-0000-000000000004', 'super_admin', true)$$,
  'forbidden', 'staff cannot create administrators');
select pg_temp.throws($$select public.admin_review_payment(gen_random_uuid(), 'verified')$$, 'forbidden',
  'staff cannot verify payments');
select pg_temp.throws($$insert into public.products (slug, sku, name_en, name_am, category_id, price_etb) values ('x','XX','x','x','11000000-0000-0000-0000-000000000001',1)$$,
  '%row-level security%', 'staff cannot create products');
reset role;

-- ---------------------------------------------------------------- manager
select pg_temp.login(:manager);
insert into public.products (slug, sku, name_en, name_am, category_id, price_etb, stock_quantity, status)
values ('test-new-product', 'TST-NEW-1', 'Test product', 'ሙከራ', '11000000-0000-0000-0000-000000000002', 500, 7, 'active');
select pg_temp.ok((select stock_quantity from public.products where sku = 'TST-NEW-1') = 7, 'manager can create a product');
select pg_temp.ok(exists (select 1 from public.inventory_movements m join public.products p on p.id = m.product_id
                          where p.sku = 'TST-NEW-1' and m.reason = 'initial' and m.change = 7),
  'opening stock recorded in inventory history');
update public.products set price_etb = 550, sale_price_etb = 499 where sku = 'TST-NEW-1';
select pg_temp.ok((select price_etb from public.products where sku = 'TST-NEW-1') = 550, 'manager can edit price');
select pg_temp.throws($$update public.products set sale_price_etb = 600 where sku = 'TST-NEW-1'$$,
  '%check constraint%', 'sale price must be below regular price');
select pg_temp.throws($$update public.products set stock_quantity = 999 where sku = 'TST-NEW-1'$$,
  '%permission denied%', 'manager cannot set stock directly (must use adjustment)');
select pg_temp.ok(public.admin_adjust_stock((select id from public.products where sku = 'TST-NEW-1'), 5, 'restock', 'Delivery') = 12,
  'manager adjusts stock through audited function');
select pg_temp.throws($$select public.admin_adjust_stock((select id from public.products where sku = 'TST-NEW-1'), -100, 'damage')$$,
  'insufficient_stock', 'stock can never go negative');
insert into public.product_images (product_id, storage_path, is_primary)
select id, 'products/test-new-product/main.webp', true from public.products where sku = 'TST-NEW-1';
select pg_temp.ok((select count(*) from public.product_images p join public.products x on x.id = p.product_id where x.sku = 'TST-NEW-1') = 1,
  'manager can attach product images');
select pg_temp.throws($$insert into public.product_images (product_id, storage_path) values ('20000000-0000-0000-0000-000000000001', '../../etc/passwd')$$,
  '%check constraint%', 'image paths cannot traverse directories');
select pg_temp.throws($$insert into public.product_images (product_id, storage_path, is_primary) select id, 'p/second.webp', true from public.products where sku = 'TST-NEW-1'$$,
  '%duplicate key%', 'only one primary image per product');
update public.products set status = 'archived' where sku = 'TST-NEW-1';
select pg_temp.ok((select archived_at is not null from public.products where sku = 'TST-NEW-1'), 'archiving sets archived_at');
select pg_temp.ok((select count(*) from public.bank_accounts) = 2, 'manager can view bank accounts (payment review)');
select pg_temp.throws($$insert into public.bank_accounts (bank_name, account_holder, account_number) values ('X Bank','X','1234567')$$,
  '%row-level security%', 'manager cannot add bank accounts');
select pg_temp.ok((select count(*) from public.audit_logs) = 0, 'manager cannot read audit log');
select pg_temp.throws($$select public.admin_set_staff_role('aaaaaaaa-0000-0000-0000-000000000003', 'manager', true)$$,
  'forbidden', 'manager cannot manage staff');
reset role;

-- ---------------------------------------------------------------- super admin
select pg_temp.login(:super);
update public.bank_accounts set account_holder = 'Updated Holder' where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.ok((select account_holder from public.bank_accounts where id = '30000000-0000-0000-0000-000000000001') = 'Updated Holder',
  'super admin can edit bank accounts');
select pg_temp.ok(exists (select 1 from public.audit_logs where entity_type = 'bank_accounts' and action = 'update'
                            and actor_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'bank account change is audit-logged with actor');
select pg_temp.throws($$update public.audit_logs set action = 'tampered'$$, '%permission denied%', 'audit log cannot be modified');
select pg_temp.throws($$select public.admin_set_staff_role('aaaaaaaa-0000-0000-0000-000000000001', 'staff', true)$$,
  'cannot_modify_self', 'super admin cannot demote themselves');
select public.admin_set_staff_role('aaaaaaaa-0000-0000-0000-000000000004', 'manager', true);
select pg_temp.ok((select r.key from public.profiles p join public.admin_roles r on r.id = p.role_id
                   where p.id = 'aaaaaaaa-0000-0000-0000-000000000004') = 'manager', 'super admin can change staff roles');
select public.admin_set_staff_role('aaaaaaaa-0000-0000-0000-000000000004', 'staff', false);
reset role;
select pg_temp.throws($$select public.bootstrap_super_admin('aaaaaaaa-0000-0000-0000-000000000002', 'Again')$$,
  'super_admin_exists', 'bootstrap refuses once a super admin exists');

-- deactivated staff lose all access
select pg_temp.login(:staff2);
select pg_temp.ok(public.my_admin_context() is null, 'deactivated staff have no admin context');
reset role;

rollback;
