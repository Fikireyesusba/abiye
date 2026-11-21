-- =============================================================================
-- 0043 PRODUCT "FOR": WOMEN / MEN / UNISEX
-- Optional on every product (e.g. perfume). The shop shows a Women / Men
-- filter when products in that list have it; unisex products appear in both.
-- =============================================================================
alter table public.products add column audience text check (audience in ('women', 'men', 'unisex'));
create index products_audience_idx on public.products(audience) where audience is not null;
grant select (audience) on public.products to anon;
grant insert (audience), update (audience) on public.products to authenticated;
