-- =============================================================================
-- PRODUCTION STARTER — run ONCE after `supabase db push` (SQL Editor or psql).
-- Creates the shop's department + subcategory structure only. No sample
-- products, no bank details, no prices: enter those in /admin.
-- Safe to re-run (existing slugs are left untouched).
-- =============================================================================
-- Fixed ids (same as the development seed) so both files can be used together.
insert into public.categories (id, department, slug, name_en, name_am, sort_order) values
  ('10000000-0000-0000-0000-000000000001', 'cosmetics',   'cosmetics',   'Cosmetics',   'የውበት ምርቶች', 1),
  ('10000000-0000-0000-0000-000000000002', 'electronics', 'electronics', 'Electronics', 'ኤሌክትሮኒክስ', 2),
  ('10000000-0000-0000-0000-000000000003', 'printing',    'printing',    'Printing',    'ህትመት',      3)
on conflict do nothing;

insert into public.categories (id, parent_id, department, slug, name_en, name_am, sort_order)
select v.id::uuid, p.id, v.department::public.department, v.slug, v.name_en, v.name_am, v.sort_order
from (values
  ('11000000-0000-0000-0000-000000000001', 'cosmetics',   'perfumes',           'Perfumes',               'ሽቶዎች',              1),
  ('11000000-0000-0000-0000-000000000002', 'cosmetics',   'skincare',           'Skincare',               'የቆዳ እንክብካቤ',        2),
  ('11000000-0000-0000-0000-000000000003', 'cosmetics',   'makeup',             'Makeup',                 'ሜካፕ',               3),
  ('11000000-0000-0000-0000-000000000004', 'cosmetics',   'haircare',           'Haircare',               'የፀጉር እንክብካቤ',       4),
  ('11000000-0000-0000-0000-000000000005', 'cosmetics',   'beauty-accessories', 'Beauty accessories',     'የውበት መለዋወጫዎች',      5),
  ('12000000-0000-0000-0000-000000000001', 'electronics', 'smartphones',        'Smartphones',            'ስማርት ስልኮች',          1),
  ('12000000-0000-0000-0000-000000000002', 'electronics', 'chargers',           'Chargers',               'ቻርጀሮች',             2),
  ('12000000-0000-0000-0000-000000000003', 'electronics', 'earphones',          'Earphones',              'የጆሮ ማዳመጫዎች',        3),
  ('12000000-0000-0000-0000-000000000004', 'electronics', 'power-banks',        'Power banks',            'ፓወር ባንኮች',          4),
  ('12000000-0000-0000-0000-000000000005', 'electronics', 'cables',             'Cables',                 'ኬብሎች',              5),
  ('12000000-0000-0000-0000-000000000006', 'electronics', 'accessories',        'Electronic accessories', 'የኤሌክትሮኒክስ መለዋወጫዎች', 6)
) as v(id, department, slug, name_en, name_am, sort_order)
join public.categories p on p.slug = v.department and p.parent_id is null
on conflict do nothing;

select department, count(*) as categories from public.categories group by department order by department;
