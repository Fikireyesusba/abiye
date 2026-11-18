-- =============================================================================
-- 0004 BUSINESS SETTINGS: website settings, banks, delivery, promotions, banners
-- =============================================================================

-- Key/value settings. Value shapes are validated by Zod in the app
-- (src/lib/validation/settings.ts). is_public controls anonymous read access.
create table public.website_settings (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  value      jsonb not null,
  is_public  boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create trigger website_settings_updated_at before update on public.website_settings
  for each row execute function private.set_updated_at();

-- Configuration defaults (clearly marked placeholders; edit in /admin/settings)
insert into public.website_settings (key, value, is_public) values
  ('business', jsonb_build_object(
      'name', jsonb_build_object('en', '[BUSINESS NAME]', 'am', '[የንግድ ስም]'),
      'tagline', jsonb_build_object('en', 'Beauty, electronics & printing in one place',
                                     'am', 'ውበት፣ ኤሌክትሮኒክስ እና ህትመት በአንድ ቦታ'),
      'logo_path', null), true),
  ('contact', jsonb_build_object(
      'phone', '+251900000000', 'email', 'hello@example.com', 'telegram', null,
      'whatsapp', null,
      'address', jsonb_build_object('en', '[Shop address], Addis Ababa', 'am', '[የሱቅ አድራሻ]፣ አዲስ አበባ'),
      'map_url', null), true),
  ('hours', jsonb_build_object(
      'en', 'Mon–Sat 8:30 AM – 7:00 PM', 'am', 'ሰኞ–ቅዳሜ 2:30 – 1:00 ሰዓት'), true),
  ('social', jsonb_build_object('facebook', null, 'instagram', null, 'tiktok', null, 'telegram', null), true),
  ('delivery', jsonb_build_object(
      'pickup_enabled', true,
      'delivery_enabled', true,
      'free_delivery_threshold_etb', null,
      'payment_window_hours', 24), true),
  ('printing', jsonb_build_object(
      'service_charge_etb', 0,
      'max_file_mb', 25,
      'max_copies', 500,
      'retention_days', 30), true),
  ('homepage', jsonb_build_object(
      'hero_title', jsonb_build_object('en', 'Everything you need, delivered across Ethiopia',
                                        'am', 'የሚፈልጉት ሁሉ፣ በመላው ኢትዮጵያ'),
      'hero_subtitle', jsonb_build_object('en', 'Genuine cosmetics, reliable electronics and fast printing services.',
                                           'am', 'እውነተኛ የውበት ምርቶች፣ አስተማማኝ ኤሌክትሮኒክስ እና ፈጣን የህትመት አገልግሎት።'),
      'hero_image_path', null,
      'why_us', jsonb_build_array(
        jsonb_build_object('en', 'Genuine products', 'am', 'እውነተኛ ምርቶች'),
        jsonb_build_object('en', 'Secure bank transfer', 'am', 'ደህንነቱ የተጠበቀ የባንክ ዝውውር'),
        jsonb_build_object('en', 'Fast delivery in Addis Ababa', 'am', 'በአዲስ አበባ ፈጣን አቅርቦት'))
    ), true);

create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  bank_name       text not null check (char_length(bank_name) between 2 and 80),
  account_holder  text not null check (char_length(account_holder) between 2 and 120),
  account_number  text not null check (account_number ~ '^[0-9 -]{6,30}$'),
  branch          text,
  instructions_en text not null default '',
  instructions_am text not null default '',
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger bank_accounts_updated_at before update on public.bank_accounts
  for each row execute function private.set_updated_at();

-- Spec name: "delivery_settings" — one row per deliverable city/zone.
create table public.delivery_zones (
  id             uuid primary key default gen_random_uuid(),
  name_en        text not null unique check (char_length(name_en) between 2 and 80),
  name_am        text not null,
  fee_etb        numeric(12,2) not null check (fee_etb >= 0),
  estimated_days text,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger delivery_zones_updated_at before update on public.delivery_zones
  for each row execute function private.set_updated_at();

create table public.promotions (
  id               uuid primary key default gen_random_uuid(),
  title_en         text not null,
  title_am         text not null,
  description_en   text not null default '',
  description_am   text not null default '',
  code             extensions.citext unique check (code ~ '^[A-Za-z0-9_-]{3,30}$'),
  discount_type    text not null check (discount_type in ('percent', 'fixed')),
  discount_value   numeric(12,2) not null check (discount_value > 0),
  min_order_etb    numeric(12,2) not null default 0 check (min_order_etb >= 0),
  category_id      uuid references public.categories(id) on delete set null,
  product_id       uuid references public.products(id) on delete set null,
  starts_at        timestamptz,
  ends_at          timestamptz,
  is_active        boolean not null default true,
  show_on_homepage boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 90),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger promotions_updated_at before update on public.promotions
  for each row execute function private.set_updated_at();

create table public.homepage_banners (
  id          uuid primary key default gen_random_uuid(),
  title_en    text not null,
  title_am    text not null,
  subtitle_en text not null default '',
  subtitle_am text not null default '',
  image_path  text not null,
  link_href   text check (link_href ~ '^/[A-Za-z0-9/_?=&.-]*$'),  -- internal links only
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger homepage_banners_updated_at before update on public.homepage_banners
  for each row execute function private.set_updated_at();
