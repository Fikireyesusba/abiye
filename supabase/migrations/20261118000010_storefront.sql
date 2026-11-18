-- =============================================================================
-- 0010 STOREFRONT SUPPORT
-- Replace the effective_price() computed field (it needs the whole row, which
-- conflicts with anon's column-level grants) with a stored generated column
-- that can be selected, sorted and indexed by the public catalog.
-- =============================================================================

drop function if exists public.effective_price(public.products);

alter table public.products
  add column effective_price_etb numeric(12,2)
  generated always as (coalesce(sale_price_etb, price_etb)) stored;

create index products_effective_price_idx on public.products(effective_price_etb)
  where status = 'active';
create index products_created_idx on public.products(created_at desc)
  where status = 'active';

grant select (effective_price_etb) on public.products to anon;

-- Fix: PostgreSQL regexes allow at most 255 repetitions, so the original
-- '{3,300}' check raised "invalid repetition count" on every insert.
alter table public.product_images drop constraint product_images_storage_path_check;
alter table public.product_images add constraint product_images_storage_path_check
  check (char_length(storage_path) between 3 and 300 and storage_path ~ '^[A-Za-z0-9/_.-]+$' and storage_path !~ '\.\.');
