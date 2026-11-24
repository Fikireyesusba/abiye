-- =============================================================================
-- SAMPLE DEVELOPMENT DATA — NOT REAL. Do not load into production.
-- `supabase db reset` loads this automatically for local development only.
-- Bank details below are FAKE placeholders.
-- =============================================================================

-- Departments (top-level) and subcategories
insert into public.categories (id, department, slug, name_en, name_am, sort_order) values
  ('10000000-0000-0000-0000-000000000001', 'cosmetics',   'cosmetics',   'Cosmetics',   'የውበት ምርቶች', 1),
  ('10000000-0000-0000-0000-000000000002', 'electronics', 'electronics', 'Electronics', 'ኤሌክትሮኒክስ', 2),
  ('10000000-0000-0000-0000-000000000003', 'printing',    'printing',    'Printing',    'ህትመት',      3)
on conflict do nothing; -- already present if supabase/starter.sql was run

insert into public.categories (id, parent_id, department, slug, name_en, name_am, sort_order) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'cosmetics', 'perfumes',           'Perfumes',           'ሽቶዎች', 1),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'cosmetics', 'skincare',           'Skincare',           'የቆዳ እንክብካቤ', 2),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'cosmetics', 'makeup',             'Makeup',             'ሜካፕ', 3),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'cosmetics', 'haircare',           'Haircare',           'የፀጉር እንክብካቤ', 4),
  ('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'cosmetics', 'beauty-accessories', 'Beauty accessories', 'የውበት መለዋወጫዎች', 5),
  ('12000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'electronics', 'smartphones',      'Smartphones',        'ስማርት ስልኮች', 1),
  ('12000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'electronics', 'chargers',         'Chargers',           'ቻርጀሮች', 2),
  ('12000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'electronics', 'earphones',        'Earphones',          'የጆሮ ማዳመጫዎች', 3),
  ('12000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'electronics', 'power-banks',      'Power banks',        'ፓወር ባንኮች', 4),
  ('12000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'electronics', 'cables',           'Cables',             'ኬብሎች', 5),
  ('12000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'electronics', 'accessories',      'Electronic accessories', 'የኤሌክትሮኒክስ መለዋወጫዎች', 6)
on conflict do nothing;

insert into public.products (id, slug, sku, name_en, name_am, description_en, description_am, brand,
                             category_id, price_etb, sale_price_etb, stock_quantity, status, is_featured) values
  ('20000000-0000-0000-0000-000000000001', 'sample-oud-perfume-100ml', 'SMP-PF-001', '[SAMPLE] Oud Eau de Parfum 100ml', '[ናሙና] ኡድ ሽቶ 100ml',
   'Sample product for development. Warm, long-lasting oud fragrance.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', 'Sample Brand',
   '11000000-0000-0000-0000-000000000001', 3200.00, 2850.00, 15, 'active', true),
  ('20000000-0000-0000-0000-000000000002', 'sample-floral-mist-50ml', 'SMP-PF-002', '[SAMPLE] Floral Body Mist 50ml', '[ናሙና] የአበባ ሽቶ 50ml',
   'Sample product for development. Light floral mist.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', 'Sample Brand',
   '11000000-0000-0000-0000-000000000001', 950.00, null, 40, 'active', false),
  ('20000000-0000-0000-0000-000000000003', 'sample-shea-moisturizer', 'SMP-SK-001', '[SAMPLE] Shea Butter Moisturizer', '[ናሙና] የሺያ ቅቤ ክሬም',
   'Sample product for development.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', null,
   '11000000-0000-0000-0000-000000000002', 680.00, null, 3, 'active', true),
  ('20000000-0000-0000-0000-000000000004', 'sample-matte-lipstick', 'SMP-MK-001', '[SAMPLE] Matte Lipstick – Ruby', '[ናሙና] ሊፕስቲክ – ሩቢ',
   'Sample product for development.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', null,
   '11000000-0000-0000-0000-000000000003', 450.00, 399.00, 60, 'active', false),
  ('20000000-0000-0000-0000-000000000005', 'sample-argan-hair-oil', 'SMP-HC-001', '[SAMPLE] Argan Hair Oil', '[ናሙና] የአርጋን የፀጉር ዘይት',
   'Sample product for development.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', null,
   '11000000-0000-0000-0000-000000000004', 720.00, null, 0, 'active', false),
  ('20000000-0000-0000-0000-000000000006', 'sample-android-phone-128gb', 'SMP-PH-001', '[SAMPLE] Android Smartphone 128GB', '[ናሙና] አንድሮይድ ስልክ 128GB',
   'Sample product for development. 6.5" display, dual SIM.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', 'Sample Mobile',
   '12000000-0000-0000-0000-000000000001', 18500.00, null, 5, 'active', true),
  ('20000000-0000-0000-0000-000000000007', 'sample-usb-c-fast-charger', 'SMP-CH-001', '[SAMPLE] 25W USB-C Fast Charger', '[ናሙና] 25W USB-C ፈጣን ቻርጀር',
   'Sample product for development.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', null,
   '12000000-0000-0000-0000-000000000002', 850.00, null, 80, 'active', true),
  ('20000000-0000-0000-0000-000000000008', 'sample-wireless-earbuds', 'SMP-EP-001', '[SAMPLE] Wireless Earbuds', '[ናሙና] ገመድ አልባ የጆሮ ማዳመጫ',
   'Sample product for development.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', null,
   '12000000-0000-0000-0000-000000000003', 2400.00, 2100.00, 25, 'active', false),
  ('20000000-0000-0000-0000-000000000009', 'sample-power-bank-20000', 'SMP-PB-001', '[SAMPLE] Power Bank 20,000mAh', '[ናሙና] ፓወር ባንክ 20,000mAh',
   'Sample product for development.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', null,
   '12000000-0000-0000-0000-000000000004', 1900.00, null, 12, 'active', false),
  ('20000000-0000-0000-0000-000000000010', 'sample-usb-c-cable-1m', 'SMP-CB-001', '[SAMPLE] USB-C Cable 1m', '[ናሙና] USB-C ኬብል 1ሜ',
   'Sample product for development.', 'ለሙከራ የተዘጋጀ ናሙና ምርት።', null,
   '12000000-0000-0000-0000-000000000005', 250.00, null, 200, 'active', false),
  ('20000000-0000-0000-0000-000000000011', 'sample-draft-phone-case', 'SMP-AC-001', '[SAMPLE] Phone Case (draft)', '[ናሙና] የስልክ መያዣ',
   'Draft sample product — not visible to customers.', 'ረቂቅ ናሙና።', null,
   '12000000-0000-0000-0000-000000000006', 300.00, null, 10, 'draft', false);

-- FAKE bank details for development only
insert into public.bank_accounts (id, bank_name, account_holder, account_number, instructions_en, instructions_am, sort_order) values
  ('30000000-0000-0000-0000-000000000001', 'Commercial Bank of Ethiopia (SAMPLE)', '[SAMPLE ACCOUNT HOLDER]', '1000000000000',
   'Transfer the exact total and keep your receipt. Use your order number as the reason/remark.',
   'ትክክለኛውን ጠቅላላ መጠን ያስተላልፉ እና ደረሰኝዎን ያስቀምጡ። የትዕዛዝ ቁጥርዎን እንደ ምክንያት ይጻፉ።', 1),
  ('30000000-0000-0000-0000-000000000002', 'Bank of Abyssinia (SAMPLE)', '[SAMPLE ACCOUNT HOLDER]', '20000000',
   'Inactive sample account.', 'ንቁ ያልሆነ ናሙና ሂሳብ።', 2);
update public.bank_accounts set is_active = false where id = '30000000-0000-0000-0000-000000000002';

-- The Ethiopian city list (0071) already added these cities switched off: replace them with the priced sample cities.
delete from public.delivery_zones where name_en in ('Addis Ababa', 'Adama', 'Bahir Dar', 'Hawassa') and id::text not like '40000000-%';
insert into public.delivery_zones (id, name_en, name_am, fee_etb, estimated_days, sort_order) values
  ('40000000-0000-0000-0000-000000000001', 'Addis Ababa', 'አዲስ አበባ', 150.00, '1–2 days', 1),
  ('40000000-0000-0000-0000-000000000002', 'Adama',       'አዳማ',     350.00, '2–3 days', 2),
  ('40000000-0000-0000-0000-000000000003', 'Bahir Dar',   'ባሕር ዳር',   500.00, '3–5 days', 3),
  ('40000000-0000-0000-0000-000000000004', 'Hawassa',     'ሀዋሳ',     450.00, '3–5 days', 4);

insert into public.printing_price_rules (color_mode, paper_size, sides, price_per_page_etb, sort_order) values
  ('bw',    'A4', 'single', 3.00, 1),
  ('bw',    'A4', 'double', 2.50, 2),
  ('color', 'A4', 'single', 12.00, 3),
  ('color', 'A4', 'double', 10.00, 4),
  ('bw',    'A3', 'single', 8.00, 5),
  ('color', 'A3', 'single', 25.00, 6);

-- LOCAL ONLY: test accounts use example / test domains; production allows @gmail.com only (migration 0046).
insert into public.website_settings (key, value, is_public)
values ('signup_email_domains', '{"domains": ["gmail.com", "example.com", "test.local", "abiye.local", "evil.test", "example.org"]}', false)
on conflict (key) do update set value = excluded.value;
