-- =============================================================================
-- 0003 CATALOG: categories, products, images, inventory movements
-- =============================================================================

create table public.categories (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid references public.categories(id) on delete restrict,
  department     public.department not null,
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en        text not null check (char_length(name_en) between 1 and 80),
  name_am        text not null check (char_length(name_am) between 1 and 80),
  description_en text,
  description_am text,
  image_path     text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index categories_parent_idx on public.categories(parent_id);
create index categories_department_idx on public.categories(department, sort_order);
create trigger categories_updated_at before update on public.categories
  for each row execute function private.set_updated_at();

-- A subcategory must belong to the same department as its parent.
create or replace function private.check_category_department()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.parent_id and c.department = new.department and c.parent_id is null
  ) then
    perform private.app_error('invalid_parent_category');
  end if;
  return new;
end;
$$;
create trigger categories_department_check before insert or update on public.categories
  for each row execute function private.check_category_department();

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku                 text not null unique check (sku ~ '^[A-Za-z0-9._-]{2,40}$'),
  name_en             text not null check (char_length(name_en) between 1 and 160),
  name_am             text not null check (char_length(name_am) between 1 and 160),
  description_en      text not null default '' check (char_length(description_en) <= 5000),
  description_am      text not null default '' check (char_length(description_am) <= 5000),
  brand               text check (char_length(brand) <= 80),
  category_id         uuid not null references public.categories(id) on delete restrict,
  price_etb           numeric(12,2) not null check (price_etb > 0),
  sale_price_etb      numeric(12,2) check (sale_price_etb > 0),
  stock_quantity      integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  track_inventory     boolean not null default true,
  status              public.product_status not null default 'draft',
  is_featured         boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,
  check (sale_price_etb is null or sale_price_etb < price_etb),
  check ((status = 'archived') = (archived_at is not null))
);
create index products_category_idx on public.products(category_id) where status = 'active';
create index products_featured_idx on public.products(is_featured) where status = 'active' and is_featured;
create index products_status_idx on public.products(status, created_at desc);
create index products_name_en_trgm on public.products using gin (name_en extensions.gin_trgm_ops);
create index products_name_am_trgm on public.products using gin (name_am extensions.gin_trgm_ops);
create index products_low_stock_idx on public.products(stock_quantity)
  where track_inventory and status = 'active';
create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

-- Keep archived_at consistent with status automatically.
create or replace function private.products_archive_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'archived' and new.archived_at is null then
    new.archived_at := now();
    new.is_featured := false;
  elsif new.status <> 'archived' then
    new.archived_at := null;
  end if;
  return new;
end;
$$;
create trigger products_archive_sync before insert or update on public.products
  for each row execute function private.products_archive_sync();

create table public.product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^[A-Za-z0-9/_.-]{3,300}$'),
  alt_en       text,
  alt_am       text,
  sort_order   integer not null default 0,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index product_images_product_idx on public.product_images(product_id, sort_order);
create unique index product_images_one_primary on public.product_images(product_id) where is_primary;

create table public.inventory_movements (
  id             bigint generated always as identity primary key,
  product_id     uuid not null references public.products(id) on delete restrict,
  change         integer not null check (change <> 0),
  quantity_after integer not null check (quantity_after >= 0),
  reason         public.inventory_reason not null,
  order_id       uuid,  -- FK added in orders migration
  note           text check (char_length(note) <= 500),
  actor_id       uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index inventory_movements_product_idx on public.inventory_movements(product_id, created_at desc);

-- Record the opening stock of a newly created product.
create or replace function private.products_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stock_quantity > 0 then
    insert into public.inventory_movements (product_id, change, quantity_after, reason, actor_id, note)
    values (new.id, new.stock_quantity, new.stock_quantity, 'initial', (select auth.uid()), 'Opening stock');
  end if;
  return new;
end;
$$;
create trigger products_initial_stock after insert on public.products
  for each row execute function private.products_initial_stock();

-- Public view of a product's effective price
create or replace function public.effective_price(p public.products)
returns numeric
language sql
immutable
set search_path = ''
as $$ select coalesce(p.sale_price_etb, p.price_etb) $$;
grant execute on function public.effective_price(public.products) to anon, authenticated, service_role;
