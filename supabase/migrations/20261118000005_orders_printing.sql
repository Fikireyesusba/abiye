-- =============================================================================
-- 0005 CUSTOMERS, ORDERS, PAYMENTS, PRINTING
-- =============================================================================

-- Guest customers, de-duplicated by normalized phone (+2519XXXXXXXX / +2517XXXXXXXX).
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null check (char_length(full_name) between 2 and 120),
  phone         text not null unique check (phone ~ '^\+251[79][0-9]{8}$'),
  email         extensions.citext,
  order_count   integer not null default 0,
  last_order_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index customers_name_trgm on public.customers using gin (full_name extensions.gin_trgm_ops);
create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

create table public.addresses (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  city          text not null check (char_length(city) between 2 and 80),
  address_line  text not null check (char_length(address_line) between 3 and 300),
  instructions  text check (char_length(instructions) <= 500),
  last_used_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (customer_id, city, address_line)
);

create sequence public.order_number_seq start with 10001;
create sequence public.print_job_number_seq start with 10001;

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  -- Human-friendly, sequential: shown to customers & staff but NEVER used
  -- alone to authorize access (see access_token_hash / tracking_code_hash).
  order_number          text not null unique default ('ET-' || nextval('public.order_number_seq')),
  access_token_hash     text not null unique check (access_token_hash ~ '^[0-9a-f]{64}$'),
  tracking_code_hash    text not null check (tracking_code_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key       uuid not null unique,
  customer_id           uuid not null references public.customers(id) on delete restrict,
  -- Snapshots: what the customer entered for THIS order
  customer_name         text not null,
  customer_phone        text not null check (customer_phone ~ '^\+251[79][0-9]{8}$'),
  fulfillment_method    public.fulfillment_method not null,
  delivery_zone_id      uuid references public.delivery_zones(id) on delete set null,
  city                  text,
  address_line          text,
  delivery_instructions text check (char_length(delivery_instructions) <= 500),
  subtotal_etb          numeric(12,2) not null check (subtotal_etb >= 0),
  delivery_fee_etb      numeric(12,2) not null default 0 check (delivery_fee_etb >= 0),
  discount_etb          numeric(12,2) not null default 0 check (discount_etb >= 0),
  total_etb             numeric(12,2) not null check (total_etb > 0),
  currency              char(3) not null default 'ETB' check (currency = 'ETB'),
  promotion_id          uuid references public.promotions(id) on delete set null,
  status                public.order_status not null default 'awaiting_payment',
  payment_status        public.payment_status not null default 'unpaid',
  -- Bank account shown at checkout, frozen for history
  bank_account_id       uuid references public.bank_accounts(id) on delete set null,
  bank_snapshot         jsonb not null,
  locale                text not null default 'en' check (locale in ('en', 'am')),
  assigned_to           uuid references public.profiles(id) on delete set null,
  payment_due_at        timestamptz not null,
  payment_verified_at   timestamptz,
  payment_verified_by   uuid references auth.users(id) on delete set null,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (total_etb = subtotal_etb + delivery_fee_etb - discount_etb),
  check (fulfillment_method = 'pickup' or (city is not null and address_line is not null)),
  check ((payment_status = 'verified') = (payment_verified_at is not null) or payment_status = 'refunded')
);
create index orders_status_idx on public.orders(status, created_at desc);
create index orders_payment_status_idx on public.orders(payment_status, created_at desc);
create index orders_customer_idx on public.orders(customer_id, created_at desc);
create index orders_assigned_idx on public.orders(assigned_to, created_at desc) where assigned_to is not null;
create index orders_phone_idx on public.orders(customer_phone);
create index orders_due_idx on public.orders(payment_due_at)
  where status in ('awaiting_payment', 'payment_rejected');
create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

alter table public.inventory_movements
  add constraint inventory_movements_order_fk foreign key (order_id)
  references public.orders(id) on delete restrict;
create index inventory_movements_order_idx on public.inventory_movements(order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- Printing
-- ---------------------------------------------------------------------------
create table public.printing_price_rules (
  id                 uuid primary key default gen_random_uuid(),
  color_mode         public.print_color_mode not null,
  paper_size         text not null check (paper_size ~ '^[A-Za-z0-9]{1,10}$'),
  sides              public.print_sides not null,
  price_per_page_etb numeric(10,2) not null check (price_per_page_etb > 0),
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (color_mode, paper_size, sides)
);
create trigger printing_price_rules_updated_at before update on public.printing_price_rules
  for each row execute function private.set_updated_at();

create table public.printing_jobs (
  id                    uuid primary key default gen_random_uuid(),
  job_number            text not null unique default ('PR-' || nextval('public.print_job_number_seq')),
  access_token_hash     text not null unique check (access_token_hash ~ '^[0-9a-f]{64}$'),
  customer_id           uuid references public.customers(id) on delete set null,
  customer_name         text not null check (char_length(customer_name) between 2 and 120),
  customer_phone        text not null check (customer_phone ~ '^\+251[79][0-9]{8}$'),
  color_mode            public.print_color_mode not null,
  paper_size            text not null,
  sides                 public.print_sides not null,
  copies                integer not null check (copies between 1 and 1000),
  page_count            integer check (page_count between 1 and 5000),
  page_count_source     text check (page_count_source in ('auto', 'admin')),
  price_per_page_etb    numeric(10,2),
  service_charge_etb    numeric(10,2) not null default 0 check (service_charge_etb >= 0),
  estimated_total_etb   numeric(12,2),
  total_etb             numeric(12,2) check (total_etb > 0),   -- authoritative price
  fulfillment_method    public.fulfillment_method not null default 'pickup',
  customer_notes        text check (char_length(customer_notes) <= 1000),
  status                public.print_job_status not null default 'submitted',
  order_id              uuid references public.orders(id) on delete set null,
  assigned_to           uuid references public.profiles(id) on delete set null,
  quoted_by             uuid references auth.users(id) on delete set null,
  quoted_at             timestamptz,
  files_delete_after    timestamptz not null default (now() + interval '30 days'),
  files_deleted_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- A job can only be paid for once it has an authoritative price.
  check (status not in ('awaiting_payment', 'payment_verification', 'printing', 'ready', 'completed')
         or total_etb is not null)
);
create index printing_jobs_status_idx on public.printing_jobs(status, created_at desc);
create index printing_jobs_order_idx on public.printing_jobs(order_id) where order_id is not null;
create index printing_jobs_retention_idx on public.printing_jobs(files_delete_after) where files_deleted_at is null;
create trigger printing_jobs_updated_at before update on public.printing_jobs
  for each row execute function private.set_updated_at();

create table public.printing_files (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.printing_jobs(id) on delete cascade,
  storage_path  text not null unique,
  original_name text not null check (char_length(original_name) <= 255),
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count    integer check (page_count > 0),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index printing_files_job_idx on public.printing_files(job_id);

create table public.printing_job_history (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.printing_jobs(id) on delete cascade,
  from_status public.print_job_status,
  to_status   public.print_job_status not null,
  changed_by  uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index printing_job_history_job_idx on public.printing_job_history(job_id, created_at);

-- ---------------------------------------------------------------------------
-- Order lines (price snapshots)
-- ---------------------------------------------------------------------------
create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  item_type       public.order_item_type not null,
  product_id      uuid references public.products(id) on delete restrict,
  printing_job_id uuid references public.printing_jobs(id) on delete restrict,
  name_en         text not null,
  name_am         text not null,
  sku             text,
  unit_price_etb  numeric(12,2) not null check (unit_price_etb > 0),
  quantity        integer not null check (quantity between 1 and 1000),
  line_total_etb  numeric(12,2) not null,
  created_at      timestamptz not null default now(),
  check (line_total_etb = unit_price_etb * quantity),
  check ((item_type = 'product' and product_id is not null and printing_job_id is null)
      or (item_type = 'printing' and printing_job_id is not null and product_id is null))
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id) where product_id is not null;

create table public.order_status_history (
  id                  bigint generated always as identity primary key,
  order_id            uuid not null references public.orders(id) on delete cascade,
  from_status         public.order_status,
  to_status           public.order_status not null,
  from_payment_status public.payment_status,
  to_payment_status   public.payment_status not null,
  changed_by          uuid references auth.users(id) on delete set null,
  note                text check (char_length(note) <= 1000),
  created_at          timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history(order_id, created_at);

create table public.order_notes (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete restrict default auth.uid(),
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index order_notes_order_idx on public.order_notes(order_id, created_at);

-- ---------------------------------------------------------------------------
-- Payment evidence
-- ---------------------------------------------------------------------------
create table public.payment_submissions (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete cascade,
  transaction_reference text check (transaction_reference ~ '^[A-Za-z0-9/_ -]{3,60}$'),
  receipt_path          text not null unique,
  receipt_mime          text not null check (receipt_mime in ('image/jpeg', 'image/png', 'application/pdf')),
  receipt_size_bytes    integer not null check (receipt_size_bytes between 1 and 10485760),
  receipt_original_name text check (char_length(receipt_original_name) <= 255),
  receipt_sha256        text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  amount_expected_etb   numeric(12,2) not null,
  status                public.submission_status not null default 'pending',
  submitted_at          timestamptz not null default now(),
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  review_note           text check (char_length(review_note) <= 1000),
  check ((status = 'pending') = (reviewed_at is null)),
  check (status <> 'rejected' or review_note is not null)
);
create index payment_submissions_order_idx on public.payment_submissions(order_id, submitted_at desc);
create index payment_submissions_pending_idx on public.payment_submissions(submitted_at) where status = 'pending';
create index payment_submissions_reference_idx on public.payment_submissions(lower(transaction_reference))
  where transaction_reference is not null;
create unique index payment_submissions_one_pending on public.payment_submissions(order_id) where status = 'pending';
