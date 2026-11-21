-- Product "for women / men / unisex"
\ir _helpers.sql
select (select id from public.products where status = 'active' order by created_at limit 1) as pid \gset
select pg_temp.login(:manager);
update public.products set audience = 'men' where id = :'pid';
select pg_temp.ok((select audience from public.products where id = :'pid') = 'men', 'manager sets For: Men');
select pg_temp.throws(format($$update public.products set audience = 'kids' where id = %L$$, :'pid'), '%products_audience_check%', 'only women / men / unisex');
reset role;
set role anon;
select pg_temp.ok((select audience from public.products where id = :'pid') = 'men', 'shop visitors can read it');
select pg_temp.throws(format($$update public.products set audience = 'women' where id = %L$$, :'pid'), '%permission denied%', 'visitors cannot change it');
reset role;
select pg_temp.login(:staff);
update public.products set audience = 'women' where id = :'pid';
reset role;
select pg_temp.ok((select audience from public.products where id = :'pid') = 'men', 'staff without products.manage cannot change it');
