-- =============================================================================
-- 0073 PARTNER SHOPS — "Abiye Business" app (phase 2)
--   * partner_shops: shops in other cities where customers collect their order (name, city, full address, landmark,
--     phone, opening hours, map link, handling fee per collected order). Managed by the Super Admin (partners.manage).
--   * New permission set "Partner shop" (partner.own): staff of one shop (partner_staff) use the Business app only.
--   * Checkout: "Pick up at a partner shop" (fulfillment pickup + partner_shop_id). The customer pays the city's
--     delivery price (same bigger-purchase discount); the order keeps a copy of the shop's address.
--   * Courier → shop hand-off with PINs both ways: the courier enters the SHOP's PIN, the shop enters the COURIER's PIN.
--     When both are checked the order is "ready for pickup" at the shop and the courier earns the full city price.
--     5 wrong PINs lock the hand-off (the office re-assigns the courier to unlock).
--   * The customer collects with their PIN; the shop enters it → completed, the shop earns its handling fee.
--   * Shop earnings and payouts (like couriers), Excel of partner orders, Telegram steps at_shop / collected.
-- =============================================================================

insert into public.admin_permissions (key, description) values
  ('partner.own', 'Business app: receive orders from couriers and hand them to customers at my shop'),
  ('partners.manage', 'Manage partner shops: details, staff, handling fee, earnings and payouts')
on conflict (key) do nothing;
insert into public.admin_roles (key, name, description, is_builtin)
values ('partner', 'Partner shop', 'Staff of a partner shop (Abiye Business app only).', true)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'partner.own' from public.admin_roles r where r.key = 'partner'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.admin_roles r cross join (values ('partner.own'), ('partners.manage')) x(k) where r.key = 'super_admin'
on conflict do nothing;

create table public.partner_shops (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique check (char_length(name) between 2 and 120),
  zone_id          uuid not null references public.delivery_zones(id) on delete restrict,
  address_line     text not null check (char_length(address_line) between 3 and 300),
  landmark         text check (char_length(landmark) <= 200),
  phone            text not null check (phone ~ '^\+251[0-9]{9}$'),
  opening_hours    text check (char_length(opening_hours) <= 200),
  map_url          text check (char_length(map_url) <= 500 and map_url ~ '^https://[^\s<>"]+$'),
  handling_fee_etb numeric(10,2) not null default 0 check (handling_fee_etb >= 0 and handling_fee_etb <= 100000),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger partner_shops_updated_at before update on public.partner_shops
  for each row execute function private.set_updated_at();

create table public.partner_staff (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  shop_id    uuid not null references public.partner_shops(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index partner_staff_shop_idx on public.partner_staff (shop_id);

create table public.partner_payouts (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.partner_shops(id) on delete restrict,
  amount_etb  numeric(12,2) not null check (amount_etb > 0),
  orders      integer not null check (orders > 0),
  reference   text check (char_length(reference) <= 80),
  note        text check (char_length(note) <= 300),
  paid_by     uuid references auth.users(id) on delete set null default auth.uid(),
  paid_at     timestamptz not null default now()
);
create index partner_payouts_shop_idx on public.partner_payouts (shop_id, paid_at desc);

create table public.partner_earnings (
  id           bigint generated always as identity primary key,
  shop_id      uuid not null references public.partner_shops(id) on delete restrict,
  order_id     uuid not null unique references public.orders(id) on delete restrict,
  order_number text not null,
  amount_etb   numeric(10,2) not null check (amount_etb >= 0),
  earned_at    timestamptz not null default now(),
  payout_id    uuid references public.partner_payouts(id) on delete restrict
);
create index partner_earnings_shop_idx on public.partner_earnings (shop_id, earned_at desc);
create index partner_earnings_unpaid_idx on public.partner_earnings (shop_id) where payout_id is null;

alter table public.orders
  add column partner_shop_id      uuid references public.partner_shops(id) on delete restrict,
  add column partner_snapshot     jsonb,
  add column handoff_courier_code text check (handoff_courier_code ~ '^[0-9]{4}$'),
  add column handoff_shop_code    text check (handoff_shop_code ~ '^[0-9]{4}$'),
  add column handoff_courier_at   timestamptz,   -- courier entered the shop's PIN
  add column handoff_shop_at      timestamptz,   -- shop entered the courier's PIN
  add column handoff_tries        integer not null default 0 check (handoff_tries >= 0),
  add column at_shop_at           timestamptz,
  add constraint orders_partner_pickup_chk check (partner_shop_id is null or fulfillment_method = 'pickup');
create index orders_partner_shop_idx on public.orders (partner_shop_id, status) where partner_shop_id is not null;

-- RLS: shop staff see their own shop's rows; partners.manage sees everything. Writes only through the functions below.
alter table public.partner_shops enable row level security;
alter table public.partner_staff enable row level security;
alter table public.partner_payouts enable row level security;
alter table public.partner_earnings enable row level security;
revoke all on public.partner_shops, public.partner_staff, public.partner_payouts, public.partner_earnings from anon, authenticated;
grant select on public.partner_shops, public.partner_staff, public.partner_payouts, public.partner_earnings to authenticated;

create or replace function private.my_partner_shop()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.shop_id from public.partner_staff s
    join public.profiles p on p.id = s.profile_id and p.is_active and p.removed_at is null
    join public.partner_shops sh on sh.id = s.shop_id and sh.is_active
   where s.profile_id = (select auth.uid())
$$;
revoke all on function private.my_partner_shop() from public;
grant execute on function private.my_partner_shop() to authenticated;

create policy partner_shops_read on public.partner_shops for select to authenticated
  using (id = (select private.my_partner_shop()) or (select private.has_permission('partners.manage')));
create policy partner_staff_read on public.partner_staff for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.has_permission('partners.manage')));
create policy partner_payouts_read on public.partner_payouts for select to authenticated
  using (shop_id = (select private.my_partner_shop()) or (select private.has_permission('partners.manage')));
create policy partner_earnings_read on public.partner_earnings for select to authenticated
  using (shop_id = (select private.my_partner_shop()) or (select private.has_permission('partners.manage')));

-- Shop staff: their shop (refused when the shop or the account is switched off).
create or replace function private.partner_shop_required()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  perform private.require_permission('partner.own');
  v := private.my_partner_shop();
  if v is null then perform private.app_error('forbidden', 'no shop'); end if;
  return v;
end;
$$;
revoke all on function private.partner_shop_required() from public;

-- ------------------------------------------------------------ checkout: partner shops customers can choose
create or replace function public.public_partner_shops()
returns table (id uuid, name text, zone_id uuid, city text, city_am text, fee_etb numeric, address_line text, landmark text, phone text,
               opening_hours text, map_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, z.id, z.name_en, z.name_am, z.fee_etb, s.address_line, s.landmark, s.phone, s.opening_hours, s.map_url
    from public.partner_shops s join public.delivery_zones z on z.id = s.zone_id and z.is_active
   where s.is_active
   order by z.sort_order, z.name_en, s.name
$$;
revoke all on function public.public_partner_shops() from public;
grant execute on function public.public_partner_shops() to anon, authenticated;
-- ------------------------------------------------------------ the order function: + pickup at a partner shop
create or replace function public.create_order(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key         uuid := (p_input ->> 'idempotency_key')::uuid;
  v_phone       text := p_input #>> '{customer,phone}';
  v_name        text := btrim(coalesce(p_input #>> '{customer,full_name}', ''));
  v_method      public.fulfillment_method := (p_input #>> '{fulfillment,method}')::public.fulfillment_method;
  v_address     text := nullif(btrim(coalesce(p_input #>> '{fulfillment,address_line}', '')), '');
  v_instr       text := nullif(btrim(coalesce(p_input #>> '{fulfillment,instructions}', '')), '');
  v_items       jsonb := p_input -> 'items';
  v_delivery    jsonb := private.setting('delivery');
  v_existing    public.orders;
  v_zone        public.delivery_zones;
  v_bank        public.bank_accounts;
  v_product     public.products;
  v_job         public.printing_jobs;
  v_customer_id uuid;
  v_order_id    uuid;
  v_order_no    text;
  v_subtotal    numeric(12,2) := 0;
  v_fee         numeric(12,2) := 0;
  v_unit        numeric(12,2);
  v_after       integer;
  v_threshold   numeric;
  r             record;
  v_lines       jsonb := '[]'::jsonb;
  v_fee_full    numeric(12,2);
  v_promo_code  text := nullif(btrim(coalesce(p_input ->> 'promotion_code', '')), '');
  v_promo       record;
  v_promo_id    uuid;
  v_discount    numeric(12,2) := 0;
  v_shop        public.partner_shops;
  v_partner_id  uuid;
begin
  if v_key is null then perform private.app_error('invalid_request', 'idempotency_key'); end if;

  -- Serialize concurrent retries of the same checkout.
  perform pg_advisory_xact_lock(hashtext(v_key::text));

  select * into v_existing from public.orders where idempotency_key = v_key;
  if found then
    -- Possession of the (random, client-held) idempotency key proves this is
    -- the same checkout; rotate access tokens so the client gets fresh ones.
    if v_existing.customer_phone <> v_phone or v_existing.status <> 'awaiting_payment' then
      perform private.app_error('idempotency_conflict');
    end if;
    update public.orders
       set access_token_hash = p_input ->> 'access_token_hash',
           tracking_code_hash = p_input ->> 'tracking_code_hash'
     where id = v_existing.id;
    return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
                              'total_etb', v_existing.total_etb, 'replayed', true);
  end if;

  -- ---- Basic validation (the app validates too; this is defence in depth)
  if char_length(v_name) not between 2 and 120 then perform private.app_error('invalid_name'); end if;
  if v_phone is null or v_phone !~ '^\+251[79][0-9]{8}$' then perform private.app_error('invalid_phone'); end if;
  if v_method is null then perform private.app_error('invalid_fulfillment'); end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 50 then
    perform private.app_error('invalid_cart');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) e
    where coalesce(e ->> 'type', '') not in ('product', 'printing')
       or (e ->> 'type' = 'product' and (
             coalesce(e ->> 'quantity', '') !~ '^[0-9]{1,3}$'
             or (e ->> 'quantity')::integer not between 1 and 100
             or coalesce(e ->> 'product_id', '') !~ '^[0-9a-f-]{36}$'))
       or (e ->> 'type' = 'printing' and coalesce(e ->> 'printing_job_id', '') !~ '^[0-9a-f-]{36}$')
  ) then
    perform private.app_error('invalid_cart');
  end if;

  -- ---- Products: lock rows in a stable order (prevents deadlocks), verify stock
  for r in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::integer)::integer as qty
    from jsonb_array_elements(v_items) e
    where e ->> 'type' = 'product'
    group by 1
    order by 1
  loop
    if r.qty > 100 then perform private.app_error('invalid_quantity', r.product_id::text); end if;
    select * into v_product from public.products where id = r.product_id for update;
    if not found or v_product.status <> 'active' then
      perform private.app_error('product_unavailable', r.product_id::text);
    end if;
    if v_product.track_inventory and v_product.stock_quantity < r.qty then
      perform private.app_error('out_of_stock', r.product_id::text);
    end if;
    v_unit := coalesce(v_product.sale_price_etb, v_product.price_etb);
    v_subtotal := v_subtotal + v_unit * r.qty;
    v_lines := v_lines || jsonb_build_object(
      'item_type', 'product', 'product_id', v_product.id, 'name_en', v_product.name_en,
      'name_am', v_product.name_am, 'sku', v_product.sku, 'unit', v_unit, 'qty', r.qty,
      'track', v_product.track_inventory);
  end loop;

  -- ---- Printing jobs: must be priced, unpaid, unattached, and owned by caller
  for r in
    select distinct (e ->> 'printing_job_id')::uuid as job_id, e ->> 'access_token_hash' as token_hash
    from jsonb_array_elements(v_items) e
    where e ->> 'type' = 'printing'
    order by 1
  loop
    select * into v_job from public.printing_jobs where id = r.job_id for update;
    if not found or v_job.access_token_hash is distinct from r.token_hash then
      perform private.app_error('printing_job_not_found', r.job_id::text);
    end if;
    if v_job.status <> 'awaiting_payment' or v_job.order_id is not null or v_job.total_etb is null then
      perform private.app_error('printing_job_not_payable', v_job.job_number);
    end if;
    v_subtotal := v_subtotal + v_job.total_etb;
    v_lines := v_lines || jsonb_build_object(
      'item_type', 'printing', 'printing_job_id', v_job.id,
      'name_en', 'Printing job ' || v_job.job_number, 'name_am', 'የህትመት ስራ ' || v_job.job_number,
      'sku', v_job.job_number, 'unit', v_job.total_etb, 'qty', 1, 'track', false);
  end loop;

  if jsonb_array_length(v_lines) = 0 then perform private.app_error('invalid_cart'); end if;

  -- ---- Fulfillment & delivery fee (server-side only)
  if v_method = 'pickup' and nullif(p_input #>> '{fulfillment,partner_shop_id}', '') is not null then
    -- Pickup at a partner shop in another city: the courier brings it there; the customer pays that city's delivery price.
    select * into v_shop from public.partner_shops
     where id = (p_input #>> '{fulfillment,partner_shop_id}')::uuid and is_active;
    if not found then perform private.app_error('invalid_pickup_point'); end if;
    select * into v_zone from public.delivery_zones where id = v_shop.zone_id and is_active;
    if not found then perform private.app_error('invalid_pickup_point'); end if;
    v_partner_id := v_shop.id;
    v_address := v_shop.name || ' — ' || v_shop.address_line;
    v_fee_full := v_zone.fee_etb;
    v_fee := round(v_zone.fee_etb * (100 - private.delivery_discount_pct_for_amount(v_subtotal)) / 100, 2);
    v_threshold := nullif(v_delivery ->> 'free_delivery_threshold_etb', '')::numeric;
    if v_threshold is not null and v_subtotal >= v_threshold then
      v_fee := 0;
    end if;
  elsif v_method = 'pickup' then
    if not coalesce((v_delivery ->> 'pickup_enabled')::boolean, true) then
      perform private.app_error('pickup_unavailable');
    end if;
    v_address := null;
  else
    if not coalesce((v_delivery ->> 'delivery_enabled')::boolean, true) then
      perform private.app_error('delivery_unavailable');
    end if;
    select * into v_zone from public.delivery_zones
     where id = nullif(p_input #>> '{fulfillment,delivery_zone_id}', '')::uuid and is_active;
    if not found then perform private.app_error('invalid_delivery_zone'); end if;
    if v_address is null or char_length(v_address) not between 3 and 300 then
      perform private.app_error('invalid_address');
    end if;
    -- Full city price (what the courier earns), then the Super Admin's discount for bigger purchases.
    v_fee_full := v_zone.fee_etb;
    v_fee := round(v_zone.fee_etb * (100 - private.delivery_discount_pct_for_amount(v_subtotal)) / 100, 2);
    v_threshold := nullif(v_delivery ->> 'free_delivery_threshold_etb', '')::numeric;
    if v_threshold is not null and v_subtotal >= v_threshold then
      v_fee := 0;
    end if;
  end if;
  if v_instr is not null and char_length(v_instr) > 500 then perform private.app_error('invalid_instructions'); end if;

  -- ---- Promotion code (validated and priced here only; the browser value is never trusted)
  if v_promo_code is not null then
    select * into v_promo from private.apply_promotion(
      v_promo_code, v_lines, v_subtotal, v_fee, nullif(current_setting('app.ordering_user_id', true), '')::uuid, true);
    v_promo_id := v_promo.promotion_id;
    v_discount := v_promo.discount_etb;
  end if;

  -- ---- Bank account shown to the customer (snapshotted)
  select * into v_bank from public.bank_accounts
   where is_active
     and (p_input ->> 'bank_account_id' is null or id = (p_input ->> 'bank_account_id')::uuid)
   order by sort_order, created_at
   limit 1;
  if not found then perform private.app_error('no_bank_account'); end if;

  -- ---- Customer (guest, keyed by phone)
  insert into public.customers as c (full_name, phone, order_count, last_order_at)
  values (v_name, v_phone, 1, now())
  on conflict (phone) do update
     set full_name = excluded.full_name, order_count = c.order_count + 1, last_order_at = now()
  returning id into v_customer_id;

  if v_method = 'delivery' then
    insert into public.addresses as a (customer_id, city, address_line, instructions)
    values (v_customer_id, v_zone.name_en, v_address, v_instr)
    on conflict (customer_id, city, address_line) do update
       set last_used_at = now(), instructions = excluded.instructions;
  end if;

  -- ---- Order
  perform private.set_status_note('Order created');
  insert into public.orders (
    access_token_hash, tracking_code_hash, idempotency_key, customer_id, customer_name, customer_phone,
    fulfillment_method, delivery_zone_id, city, address_line, delivery_instructions,
    subtotal_etb, delivery_fee_etb, delivery_fee_full_etb, discount_etb, total_etb,
    promotion_id, bank_account_id, bank_snapshot, locale, payment_due_at, partner_shop_id, partner_snapshot)
  values (
    p_input ->> 'access_token_hash', p_input ->> 'tracking_code_hash', v_key, v_customer_id, v_name, v_phone,
    v_method, v_zone.id, case when v_method = 'delivery' or v_partner_id is not null then v_zone.name_en end, v_address, v_instr,
    v_subtotal, v_fee, v_fee_full, v_discount, v_subtotal + v_fee - v_discount,
    v_promo_id, v_bank.id,
    jsonb_build_object('bank_name', v_bank.bank_name, 'account_holder', v_bank.account_holder,
                       'account_number', v_bank.account_number, 'branch', v_bank.branch,
                       'instructions_en', v_bank.instructions_en, 'instructions_am', v_bank.instructions_am),
    case when p_input ->> 'locale' = 'am' then 'am' else 'en' end,
    now() + make_interval(hours => coalesce((v_delivery ->> 'payment_window_hours')::integer, 24)),
    v_partner_id,
    case when v_partner_id is not null then jsonb_strip_nulls(jsonb_build_object('name', v_shop.name, 'city', v_zone.name_en, 'city_am', v_zone.name_am,
      'address_line', v_shop.address_line, 'landmark', v_shop.landmark, 'phone', v_shop.phone, 'opening_hours', v_shop.opening_hours, 'map_url', v_shop.map_url)) end)
  returning id, order_number into v_order_id, v_order_no;

  -- ---- Lines + stock reservation
  for r in select * from jsonb_array_elements(v_lines) l(line) loop
    insert into public.order_items (order_id, item_type, product_id, printing_job_id, name_en, name_am, sku,
                                    unit_price_etb, quantity, line_total_etb)
    values (v_order_id, (r.line ->> 'item_type')::public.order_item_type,
            (r.line ->> 'product_id')::uuid, (r.line ->> 'printing_job_id')::uuid,
            r.line ->> 'name_en', r.line ->> 'name_am', r.line ->> 'sku',
            (r.line ->> 'unit')::numeric, (r.line ->> 'qty')::integer,
            (r.line ->> 'unit')::numeric * (r.line ->> 'qty')::integer);

    if (r.line ->> 'track')::boolean then
      update public.products set stock_quantity = stock_quantity - (r.line ->> 'qty')::integer
       where id = (r.line ->> 'product_id')::uuid
      returning stock_quantity into v_after;
      insert into public.inventory_movements (product_id, change, quantity_after, reason, order_id)
      values ((r.line ->> 'product_id')::uuid, -(r.line ->> 'qty')::integer, v_after, 'order_reserved', v_order_id);
    end if;

    if r.line ->> 'item_type' = 'printing' then
      update public.printing_jobs set order_id = v_order_id, customer_id = v_customer_id
       where id = (r.line ->> 'printing_job_id')::uuid;
    end if;
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no,
                            'total_etb', v_subtotal + v_fee - v_discount, 'discount_etb', v_discount, 'replayed', false);
end;
$$;

-- ------------------------------------------------------------ assigning a courier (home delivery or partner shop)
create or replace function public.admin_assign_courier(p_order_id uuid, p_courier uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
  v_old uuid;
  v_code text := lpad((floor(random() * 10000))::int::text, 4, '0');
begin
  perform private.require_permission('orders.manage');
  select * into v from public.orders where id = p_order_id for update;
  if not found then perform private.app_error('not_found'); end if;
  if v.fulfillment_method <> 'delivery' and v.partner_shop_id is null then perform private.app_error('invalid_request', 'pickup order'); end if;
  if v.status not in ('confirmed', 'processing', 'out_for_delivery') then perform private.app_error('invalid_transition'); end if;
  if p_courier is not null and not exists (
       select 1 from public.profiles p join public.admin_roles r on r.id = p.role_id
        where p.id = p_courier and p.is_active and r.key = 'courier') then
    perform private.app_error('invalid_assignee');
  end if;
  if p_courier is null and v.status = 'out_for_delivery' then perform private.app_error('invalid_transition', 'on the way'); end if;
  v_old := v.courier_id;
  update public.orders
     set courier_id = p_courier,
         courier_assigned_at = case when p_courier is null then null else now() end,
         delivery_code = case when p_courier is null then delivery_code else coalesce(delivery_code, lpad((floor(random() * 10000))::int::text, 4, '0')) end,
         delivery_code_tries = 0,
         -- Partner shop: one PIN the courier gives the shop, one the shop gives the courier (new courier → new PINs).
         handoff_courier_code = case when partner_shop_id is null or p_courier is null then handoff_courier_code
                                     when v_old is distinct from p_courier or handoff_courier_code is null then v_code else handoff_courier_code end,
         handoff_shop_code = case when partner_shop_id is null or p_courier is null then handoff_shop_code
                                  when v_old is distinct from p_courier or handoff_shop_code is null
                                    then lpad(((v_code::int + 1 + floor(random() * 9998))::int % 10000)::text, 4, '0') else handoff_shop_code end,
         handoff_courier_at = case when v_old is distinct from p_courier then null else handoff_courier_at end,
         handoff_shop_at = case when v_old is distinct from p_courier then null else handoff_shop_at end,
         handoff_tries = 0
   where id = v.id
  returning * into v;
  perform private.audit(case when p_courier is null then 'courier_unassigned' else 'courier_assigned' end, 'order', v.id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('order_number', v.order_number, 'courier_user_id', private.member_of(p_courier))));
  if v_old is not null and v_old is distinct from p_courier then
    perform private.notify_courier(v_old, 'unassigned', 'Delivery ' || v.order_number || ' was taken back', 'The office gave it to someone else or will deliver it another way.', v.id);
  end if;
  if p_courier is not null and v_old is distinct from p_courier then
    perform private.notify_courier(p_courier, 'assigned', 'New delivery: ' || v.order_number,
      case when v.partner_shop_id is not null then 'To partner shop ' || coalesce(v.partner_snapshot ->> 'name', '') || ' — ' || coalesce(v.city, '')
           else coalesce(v.city, '') || coalesce(' — ' || v.address_line, '') end, v.id);
  end if;
  if p_courier is not null then perform private.delivery_event(v, 'assigned'); end if;
end;
$$;

-- ------------------------------------------------------------ courier app: deliveries (partner shop orders show the shop, not the customer)
drop function if exists public.courier_deliveries();
create function public.courier_deliveries()
returns table (order_id uuid, order_number text, status text, customer_name text, customer_phone text, city text,
               address_line text, delivery_instructions text, items jsonb, total_etb numeric, assigned_at timestamptz,
               picked_up_at timestamptz, delivered_at timestamptz, fail_reason text, active boolean,
               partner_shop text, partner_phone text, partner_landmark text, partner_map_url text, partner_hours text,
               handoff_code text, handoff_courier_done boolean, handoff_shop_done boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  return query
    select o.id, o.order_number::text, o.status::text,
           case when a and o.partner_shop_id is null then o.customer_name end, case when a and o.partner_shop_id is null then o.customer_phone end, o.city,
           case when a then case when o.partner_shop_id is null then o.address_line else o.partner_snapshot ->> 'address_line' end end,
           case when a and o.partner_shop_id is null then o.delivery_instructions end,
           (select coalesce(jsonb_agg(jsonb_build_object('name', i.name_en, 'quantity', i.quantity) order by i.created_at), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id),
           o.total_etb, o.courier_assigned_at, o.picked_up_at, coalesce(o.at_shop_at, o.delivered_at), o.delivery_fail_reason, a,
           o.partner_snapshot ->> 'name', case when a then o.partner_snapshot ->> 'phone' end, case when a then o.partner_snapshot ->> 'landmark' end,
           case when a then o.partner_snapshot ->> 'map_url' end, case when a then o.partner_snapshot ->> 'opening_hours' end,
           case when a and o.status = 'out_for_delivery' then o.handoff_courier_code end,
           o.handoff_courier_at is not null, o.handoff_shop_at is not null
      from public.orders o
      cross join lateral (select o.status in ('confirmed', 'processing', 'out_for_delivery') as a) x
     where o.courier_id = (select auth.uid())
       and (a or (coalesce(o.at_shop_at, o.delivered_at) > now() - interval '24 hours'))
     order by a desc, o.courier_assigned_at;
end;
$$;
revoke all on function public.courier_deliveries() from public, anon;
grant execute on function public.courier_deliveries() to authenticated;

-- Home delivery only (partner shop orders are finished by the hand-off).
create or replace function public.courier_deliver(p_order_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
begin
  if v.status <> 'out_for_delivery' or v.partner_shop_id is not null then perform private.app_error('invalid_transition'); end if;
  if v.delivery_code_tries >= 5 then perform private.app_error('delivery_locked'); end if;
  if v.delivery_code is null or coalesce(btrim(p_code), '') <> v.delivery_code then
    update public.orders set delivery_code_tries = delivery_code_tries + 1 where id = v.id returning * into v;
    if v.delivery_code_tries >= 5 then
      perform private.audit('delivery_code_locked', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
      perform private.delivery_event(v, 'code_locked');
    end if;
    return false;
  end if;
  perform private.set_status_note('Delivered — customer''s PIN checked by the courier');
  update public.orders set status = 'completed', delivered_at = now() where id = v.id returning * into v;
  insert into public.courier_earnings (courier_id, order_id, order_number, amount_etb)
  values (v.courier_id, v.id, v.order_number, coalesce(v.delivery_fee_full_etb, (select fee_etb from public.delivery_zones where id = v.delivery_zone_id), v.delivery_fee_etb, 0))
  on conflict (order_id) do nothing;
  perform private.audit('delivery_completed', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
  perform private.delivery_event(v, 'delivered');
  return true;
end;
$$;

-- Couldn't deliver: also undoes a half-done shop hand-off.
create or replace function public.courier_fail(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) not between 3 and 300 then perform private.app_error('invalid_reason'); end if;
  if v.status <> 'out_for_delivery' then perform private.app_error('invalid_transition'); end if;
  perform private.set_status_note('Courier could not deliver: ' || v_reason);
  update public.orders
     set status = 'processing', delivery_failed_at = now(), delivery_fail_reason = v_reason, delivery_attempts = delivery_attempts + 1,
         handoff_courier_at = null, handoff_shop_at = null
   where id = v.id returning * into v;
  perform private.audit('delivery_failed', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number, 'reason', v_reason));
  perform private.delivery_event(v, 'failed', jsonb_build_object('reason', v_reason));
end;
$$;

-- Both PINs checked → the order is at the shop (ready for the customer); the courier earns the full city price.
create or replace function private.finish_handoff(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
begin
  select * into v from public.orders where id = p_order_id for update;
  if v.status <> 'out_for_delivery' or v.handoff_courier_at is null or v.handoff_shop_at is null then return; end if;
  perform private.set_status_note('Handed over to partner shop ' || coalesce(v.partner_snapshot ->> 'name', '') || ' — PINs checked both ways');
  update public.orders set status = 'ready_for_pickup', at_shop_at = now(), delivery_code_tries = 0 where id = v.id returning * into v;
  insert into public.courier_earnings (courier_id, order_id, order_number, amount_etb)
  values (v.courier_id, v.id, v.order_number, coalesce(v.delivery_fee_full_etb, (select fee_etb from public.delivery_zones where id = v.delivery_zone_id), v.delivery_fee_etb, 0))
  on conflict (order_id) do nothing;
  perform private.audit('delivery_at_partner_shop', 'order', v.id::text, null, null,
    jsonb_build_object('order_number', v.order_number, 'shop', v.partner_snapshot ->> 'name'));
  perform private.delivery_event(v, 'at_shop', jsonb_build_object('shop', v.partner_snapshot ->> 'name'));
end;
$$;
revoke all on function private.finish_handoff(uuid) from public;

-- A wrong hand-off PIN is counted (5 → locked until the office re-assigns the courier). Answers with a result
-- (true / false) instead of an error so the counted try is kept.
create or replace function private.handoff_wrong(v public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tries integer;
begin
  update public.orders set handoff_tries = handoff_tries + 1 where id = v.id returning handoff_tries into v_tries;
  if v_tries >= 5 then
    perform private.audit('handoff_locked', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
    perform private.delivery_event(v, 'handoff_locked', jsonb_build_object('shop', v.partner_snapshot ->> 'name'));
  end if;
end;
$$;
revoke all on function private.handoff_wrong(public.orders) from public;

-- Courier at the shop: enters the PIN the shop shows them.
create or replace function public.courier_handoff(p_order_id uuid, p_shop_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
begin
  if v.partner_shop_id is null or v.status <> 'out_for_delivery' then perform private.app_error('invalid_transition'); end if;
  if v.handoff_tries >= 5 then perform private.app_error('handoff_locked'); end if;
  if v.handoff_courier_at is null then
    if v.handoff_shop_code is null or coalesce(btrim(p_shop_code), '') <> v.handoff_shop_code then
      perform private.handoff_wrong(v);
      return false;
    end if;
    update public.orders set handoff_courier_at = now() where id = v.id;
    perform private.audit('handoff_courier_confirmed', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
  end if;
  perform private.finish_handoff(v.id);
  return true;
end;
$$;

-- ------------------------------------------------------------ Business app (partner shop staff)
create or replace function private.partner_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid := private.partner_shop_required();
  v public.orders;
begin
  select * into v from public.orders where id = p_order_id for update;
  if not found or v.partner_shop_id is distinct from v_shop or v.payment_status <> 'verified' then perform private.app_error('not_found'); end if;
  return v;
end;
$$;
revoke all on function private.partner_order(uuid) from public;

-- Shop: the courier arrived — enter the courier's PIN.
create or replace function public.partner_receive(p_order_id uuid, p_courier_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.partner_order(p_order_id);
begin
  if v.status <> 'out_for_delivery' then perform private.app_error('invalid_transition'); end if;
  if v.handoff_tries >= 5 then perform private.app_error('handoff_locked'); end if;
  if v.handoff_shop_at is null then
    if v.handoff_courier_code is null or coalesce(btrim(p_courier_code), '') <> v.handoff_courier_code then
      perform private.handoff_wrong(v);
      return false;
    end if;
    update public.orders set handoff_shop_at = now() where id = v.id;
    perform private.audit('handoff_shop_confirmed', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
  end if;
  perform private.finish_handoff(v.id);
  return true;
end;
$$;

-- Shop: the customer came — enter the customer's PIN → completed; the shop earns its handling fee.
create or replace function public.partner_hand_over(p_order_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.partner_order(p_order_id);
begin
  if v.status <> 'ready_for_pickup' then perform private.app_error('invalid_transition'); end if;
  if v.delivery_code_tries >= 5 then perform private.app_error('delivery_locked'); end if;
  if v.delivery_code is null or coalesce(btrim(p_pin), '') <> v.delivery_code then
    update public.orders set delivery_code_tries = delivery_code_tries + 1 where id = v.id returning * into v;
    if v.delivery_code_tries >= 5 then
      perform private.audit('delivery_code_locked', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
      perform private.delivery_event(v, 'code_locked', jsonb_build_object('shop', v.partner_snapshot ->> 'name'));
    end if;
    return false;
  end if;
  perform private.set_status_note('Collected by the customer at partner shop ' || coalesce(v.partner_snapshot ->> 'name', '') || ' — PIN checked');
  update public.orders set status = 'completed', delivered_at = now() where id = v.id returning * into v;
  insert into public.partner_earnings (shop_id, order_id, order_number, amount_etb)
  values (v.partner_shop_id, v.id, v.order_number, (select handling_fee_etb from public.partner_shops where id = v.partner_shop_id))
  on conflict (order_id) do nothing;
  perform private.audit('partner_order_collected', 'order', v.id::text, null, null,
    jsonb_build_object('order_number', v.order_number, 'shop', v.partner_snapshot ->> 'name'));
  perform private.delivery_event(v, 'collected', jsonb_build_object('shop', v.partner_snapshot ->> 'name'));
  return true;
end;
$$;

-- Shop's orders: expected (paid, not yet on the way), incoming (courier on the way: shop PIN to give the courier),
-- at the shop (customer name / phone to call them), collected (last 7 days).
create or replace function public.partner_orders()
returns table (order_id uuid, order_number text, status text, stage text, items jsonb, courier_name text, courier_phone text,
               shop_code text, shop_confirmed boolean, courier_confirmed boolean, handoff_locked boolean,
               customer_name text, customer_phone text, pin_locked boolean, paid_at timestamptz, at_shop_at timestamptz, collected_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid := private.partner_shop_required();
begin
  return query
    select o.id, o.order_number::text, o.status::text, st,
           (select coalesce(jsonb_agg(jsonb_build_object('name', i.name_en, 'quantity', i.quantity) order by i.created_at), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id),
           case when st in ('expected', 'incoming') then cpr.full_name end,
           case when st in ('expected', 'incoming') then cp.phone end,
           case when st = 'incoming' then o.handoff_shop_code end,
           o.handoff_shop_at is not null, o.handoff_courier_at is not null, o.handoff_tries >= 5,
           case when st = 'at_shop' then o.customer_name end, case when st = 'at_shop' then o.customer_phone end,
           o.delivery_code_tries >= 5, o.payment_verified_at, o.at_shop_at, case when st = 'collected' then o.delivered_at end
      from public.orders o
      cross join lateral (select case when o.status = 'out_for_delivery' then 'incoming' when o.status = 'ready_for_pickup' then 'at_shop'
                                      when o.status = 'completed' then 'collected' else 'expected' end as st) x
      left join public.profiles cpr on cpr.id = o.courier_id
      left join public.courier_profiles cp on cp.profile_id = o.courier_id
     where o.partner_shop_id = v_shop and o.payment_status = 'verified'
       and (o.status in ('confirmed', 'processing', 'out_for_delivery', 'ready_for_pickup')
            or (o.status = 'completed' and o.delivered_at > now() - interval '7 days'))
     order by case st when 'incoming' then 0 when 'at_shop' then 1 when 'expected' then 2 else 3 end, o.payment_verified_at;
end;
$$;

create or replace function public.partner_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid := private.partner_shop_required();
  v_uid uuid := (select auth.uid());
  v_month timestamptz := date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
begin
  return (
    select jsonb_build_object(
      'full_name', (select full_name from public.profiles where id = v_uid), 'member_id', private.member_of(v_uid),
      'email', (select email from auth.users where id = v_uid),
      'shop_id', s.id, 'shop', s.name, 'city', z.name_en, 'address_line', s.address_line, 'landmark', s.landmark, 'phone', s.phone,
      'opening_hours', s.opening_hours, 'map_url', s.map_url, 'handling_fee_etb', s.handling_fee_etb,
      'incoming', (select count(*) from public.orders o where o.partner_shop_id = s.id and o.status = 'out_for_delivery'),
      'at_shop', (select count(*) from public.orders o where o.partner_shop_id = s.id and o.status = 'ready_for_pickup'),
      'month_orders', (select count(*) from public.partner_earnings e where e.shop_id = s.id and e.earned_at >= v_month),
      'month_etb', (select coalesce(sum(amount_etb), 0) from public.partner_earnings e where e.shop_id = s.id and e.earned_at >= v_month),
      'unpaid_etb', (select coalesce(sum(amount_etb), 0) from public.partner_earnings e where e.shop_id = s.id and e.payout_id is null),
      'total_orders', (select count(*) from public.partner_earnings e where e.shop_id = s.id))
    from public.partner_shops s join public.delivery_zones z on z.id = s.zone_id
    where s.id = v_shop);
end;
$$;

-- ------------------------------------------------------------ admin (Super Admin: partners.manage)
create or replace function public.admin_partner_shops()
returns table (id uuid, name text, zone_id uuid, city text, address_line text, landmark text, phone text, opening_hours text, map_url text,
               handling_fee_etb numeric, is_active boolean, staff text, staff_count bigint, incoming bigint, at_shop bigint,
               collected_month bigint, unpaid_etb numeric, last_collected_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month timestamptz := date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
  v_full boolean := private.has_permission('partners.manage');
begin
  if not (v_full or private.has_permission('orders.manage')) then perform private.app_error('forbidden'); end if;
  return query
    select s.id, s.name, s.zone_id, z.name_en, s.address_line, s.landmark, s.phone, s.opening_hours, s.map_url,
           case when v_full then s.handling_fee_etb end, s.is_active,
           (select string_agg(p.full_name, ', ' order by p.full_name) from public.partner_staff ps join public.profiles p on p.id = ps.profile_id
             where ps.shop_id = s.id and p.removed_at is null),
           (select count(*) from public.partner_staff ps join public.profiles p on p.id = ps.profile_id where ps.shop_id = s.id and p.is_active and p.removed_at is null),
           (select count(*) from public.orders o where o.partner_shop_id = s.id and o.status = 'out_for_delivery'),
           (select count(*) from public.orders o where o.partner_shop_id = s.id and o.status = 'ready_for_pickup'),
           (select count(*) from public.partner_earnings e where e.shop_id = s.id and e.earned_at >= v_month),
           case when v_full then (select coalesce(sum(e.amount_etb), 0) from public.partner_earnings e where e.shop_id = s.id and e.payout_id is null) end,
           (select max(e.earned_at) from public.partner_earnings e where e.shop_id = s.id)
      from public.partner_shops s join public.delivery_zones z on z.id = s.zone_id
     order by s.is_active desc, z.name_en, s.name;
end;
$$;

-- Create (p_id null) or update a shop. Returns its id.
create or replace function public.admin_save_partner_shop(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_zone uuid := nullif(p ->> 'zone_id', '')::uuid;
  v_fee numeric := coalesce(nullif(p ->> 'handling_fee_etb', '')::numeric, 0);
begin
  perform private.require_permission('partners.manage');
  if char_length(v_name) not between 2 and 120 or v_zone is null or not exists (select 1 from public.delivery_zones where id = v_zone)
     or char_length(btrim(coalesce(p ->> 'address_line', ''))) not between 3 and 300
     or coalesce(p ->> 'phone', '') !~ '^\+251[0-9]{9}$' or v_fee < 0 or v_fee > 100000
     or (nullif(p ->> 'map_url', '') is not null and (char_length(p ->> 'map_url') > 500 or (p ->> 'map_url') !~ '^https://[^\s<>"]+$')) then
    perform private.app_error('invalid_request');
  end if;
  if exists (select 1 from public.partner_shops where lower(name) = lower(v_name) and id is distinct from p_id) then
    perform private.app_error('invalid_request', 'name taken');
  end if;
  if p_id is null then
    insert into public.partner_shops (name, zone_id, address_line, landmark, phone, opening_hours, map_url, handling_fee_etb, is_active)
    values (v_name, v_zone, btrim(p ->> 'address_line'), nullif(btrim(coalesce(p ->> 'landmark', '')), ''), p ->> 'phone',
            nullif(btrim(coalesce(p ->> 'opening_hours', '')), ''), nullif(p ->> 'map_url', ''), v_fee, coalesce((p ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.partner_shops set name = v_name, zone_id = v_zone, address_line = btrim(p ->> 'address_line'),
           landmark = nullif(btrim(coalesce(p ->> 'landmark', '')), ''), phone = p ->> 'phone',
           opening_hours = nullif(btrim(coalesce(p ->> 'opening_hours', '')), ''), map_url = nullif(p ->> 'map_url', ''),
           handling_fee_etb = v_fee, is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = p_id returning id into v_id;
    if v_id is null then perform private.app_error('not_found'); end if;
  end if;
  perform private.audit(case when p_id is null then 'partner_shop_created' else 'partner_shop_updated' end, 'partner_shop', v_id::text, null, null,
    jsonb_build_object('name', v_name, 'handling_fee_etb', v_fee, 'active', coalesce((p ->> 'is_active')::boolean, true)));
  return v_id;
end;
$$;

-- Staff with the "Partner shop" permission set and their shop.
create or replace function public.admin_partner_staff()
returns table (id uuid, member_id text, full_name text, email text, is_active boolean, shop_id uuid, shop text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('partners.manage');
  return query
    select p.id, private.member_of(p.id), p.full_name, u.email::text, p.is_active, ps.shop_id, s.name
      from public.profiles p
      join public.admin_roles r on r.id = p.role_id and r.key = 'partner'
      join auth.users u on u.id = p.id
      left join public.partner_staff ps on ps.profile_id = p.id
      left join public.partner_shops s on s.id = ps.shop_id
     where p.removed_at is null
     order by s.name nulls first, p.full_name;
end;
$$;

create or replace function public.admin_set_partner_staff(p_profile uuid, p_shop uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('partners.manage');
  if not exists (select 1 from public.profiles p join public.admin_roles r on r.id = p.role_id where p.id = p_profile and r.key = 'partner') then
    perform private.app_error('invalid_assignee');
  end if;
  if p_shop is null then
    delete from public.partner_staff where profile_id = p_profile;
  else
    if not exists (select 1 from public.partner_shops where id = p_shop) then perform private.app_error('not_found'); end if;
    insert into public.partner_staff (profile_id, shop_id) values (p_profile, p_shop)
    on conflict (profile_id) do update set shop_id = excluded.shop_id;
  end if;
  perform private.audit('partner_staff_set', 'partner_shop', coalesce(p_shop::text, ''), null, null,
    jsonb_build_object('staff_user_id', private.member_of(p_profile), 'shop', (select name from public.partner_shops where id = p_shop)));
end;
$$;

create or replace function public.admin_pay_partner(p_shop uuid, p_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum numeric(12,2);
  v_n integer;
  v_id uuid;
begin
  perform private.require_permission('partners.manage');
  if not private.mfa_verified() then perform private.app_error('forbidden'); end if;
  perform 1 from public.partner_earnings where shop_id = p_shop and payout_id is null for update;
  select coalesce(sum(amount_etb), 0), count(*) into v_sum, v_n from public.partner_earnings where shop_id = p_shop and payout_id is null;
  if v_n = 0 or v_sum <= 0 then perform private.app_error('invalid_amount'); end if;
  insert into public.partner_payouts (shop_id, amount_etb, orders, reference, note)
  values (p_shop, v_sum, v_n, nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  update public.partner_earnings set payout_id = v_id where shop_id = p_shop and payout_id is null;
  perform private.audit('partner_paid', 'partner_shop', p_shop::text, null, null,
    jsonb_build_object('amount_etb', v_sum, 'orders', v_n, 'reference', p_reference, 'shop', (select name from public.partner_shops where id = p_shop)));
  return jsonb_build_object('payout_id', v_id, 'amount_etb', v_sum, 'orders', v_n);
end;
$$;

-- Excel: orders collected at partner shops (Super Admin).
create or replace function public.admin_partner_orders(p_from timestamptz, p_to timestamptz, p_shop uuid default null)
returns table (order_number text, shop text, city text, status text, courier_user_id text, paid_at timestamptz, picked_up_at timestamptz,
               at_shop_at timestamptz, collected_at timestamptz, delivery_fee_etb numeric, delivery_fee_full_etb numeric, order_total_etb numeric,
               shop_earned_etb numeric, paid_out_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('partners.manage');
  return query
    select o.order_number::text, o.partner_snapshot ->> 'name', o.city, o.status::text, private.member_of(o.courier_id), o.payment_verified_at,
           o.picked_up_at, o.at_shop_at, case when o.status = 'completed' then o.delivered_at end, o.delivery_fee_etb, o.delivery_fee_full_etb,
           o.total_etb, e.amount_etb, po.paid_at
      from public.orders o
      left join public.partner_earnings e on e.order_id = o.id
      left join public.partner_payouts po on po.id = e.payout_id
     where o.partner_shop_id is not null and o.payment_status in ('verified', 'refunded')
       and (p_shop is null or o.partner_shop_id = p_shop)
       and coalesce(o.delivered_at, o.at_shop_at, o.payment_verified_at, o.created_at) >= p_from
       and coalesce(o.delivered_at, o.at_shop_at, o.payment_verified_at, o.created_at) < p_to
     order by coalesce(o.delivered_at, o.at_shop_at, o.payment_verified_at, o.created_at)
     limit 20000;
end;
$$;

-- Dispatch: paid home-delivery AND partner-shop orders waiting for a courier.
drop function if exists public.admin_dispatch_orders();
create function public.admin_dispatch_orders()
returns table (order_id uuid, order_number text, status text, zone_id uuid, city text, address_line text, total_etb numeric, paid_at timestamptz,
               courier_id uuid, delivery_attempts integer, fail_reason text, items integer, courier_pay_etb numeric, delivery_fee_etb numeric,
               partner_shop text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('orders.manage');
  return query
    select o.id, o.order_number::text, o.status::text, o.delivery_zone_id, o.city,
           case when o.partner_shop_id is null then o.address_line else o.partner_snapshot ->> 'address_line' end,
           o.total_etb, o.payment_verified_at, o.courier_id,
           o.delivery_attempts, o.delivery_fail_reason, (select coalesce(sum(i.quantity), 0)::int from public.order_items i where i.order_id = o.id),
           coalesce(o.delivery_fee_full_etb, o.delivery_fee_etb), o.delivery_fee_etb, o.partner_snapshot ->> 'name'
      from public.orders o
     where (o.fulfillment_method = 'delivery' or o.partner_shop_id is not null) and o.status in ('confirmed', 'processing')
       and o.payment_status = 'verified'
       and (o.courier_id is null or o.delivery_failed_at is not null)
     order by o.payment_verified_at nulls last
     limit 200;
end;
$$;

create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Excel downloads are for the Super Admin only.
  if coalesce(private.current_role_key(), '') <> 'super_admin' or not private.mfa_verified() then perform private.app_error('forbidden'); end if;
  if p_kind = 'orders' then perform private.require_permission('orders.view_all');
  elsif p_kind = 'activity' then perform private.require_permission('audit.view');
  elsif p_kind = 'payments' then perform private.require_permission('payments.view');
  elsif p_kind = 'sales' then perform private.require_permission('analytics.view');
  elsif p_kind = 'all' then perform private.require_permission('data.manage');
  elsif p_kind = 'notifications' then perform private.require_permission('settings.manage');
  elsif p_kind = 'users' then perform private.require_permission('security.manage');
  elsif p_kind = 'support' then perform private.require_permission('support.view');
  elsif p_kind = 'customers' then perform private.require_permission('customers.view');
  elsif p_kind = 'products' then perform private.require_permission('products.view');
  elsif p_kind = 'wallet' then perform private.require_permission('wallet.manage');
  elsif p_kind = 'printing' then perform private.require_permission('printing.view');
  elsif p_kind = 'kpi' then perform private.require_permission('kpi.view');
  elsif p_kind = 'promotions' then perform private.require_permission('promotions.manage');
  elsif p_kind = 'courier_orders' then perform private.require_permission('couriers.manage');
  elsif p_kind = 'partner_orders' then perform private.require_permission('partners.manage');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;

revoke all on function public.courier_handoff(uuid, text) from public, anon;
revoke all on function public.partner_receive(uuid, text) from public, anon;
revoke all on function public.partner_hand_over(uuid, text) from public, anon;
revoke all on function public.partner_orders() from public, anon;
revoke all on function public.partner_me() from public, anon;
revoke all on function public.admin_partner_shops() from public, anon;
revoke all on function public.admin_save_partner_shop(uuid, jsonb) from public, anon;
revoke all on function public.admin_partner_staff() from public, anon;
revoke all on function public.admin_set_partner_staff(uuid, uuid) from public, anon;
revoke all on function public.admin_pay_partner(uuid, text, text) from public, anon;
revoke all on function public.admin_partner_orders(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.admin_dispatch_orders() from public, anon;
grant execute on function public.courier_handoff(uuid, text) to authenticated;
grant execute on function public.partner_receive(uuid, text) to authenticated;
grant execute on function public.partner_hand_over(uuid, text) to authenticated;
grant execute on function public.partner_orders() to authenticated;
grant execute on function public.partner_me() to authenticated;
grant execute on function public.admin_partner_shops() to authenticated;
grant execute on function public.admin_save_partner_shop(uuid, jsonb) to authenticated;
grant execute on function public.admin_partner_staff() to authenticated;
grant execute on function public.admin_set_partner_staff(uuid, uuid) to authenticated;
grant execute on function public.admin_pay_partner(uuid, text, text) to authenticated;
grant execute on function public.admin_partner_orders(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.admin_dispatch_orders() to authenticated;

-- Reset test data also clears partner shop earnings and payouts (the shops and their staff stay).
create or replace function public.admin_reset_test_data(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_counts jsonb;
  n_orders int; n_jobs int; n_customers int; n_accounts int; n_topups int; n_reviews int; n_audit int;
begin
  perform private.require_permission('data.manage');
  if p_confirm is distinct from public.admin_reset_phrase() then
    perform private.app_error('invalid_request', 'confirmation');
  end if;
  if not exists (select 1 from public.audit_logs where action = 'export_all' and actor_id = v_uid and created_at > now() - interval '30 minutes') then
    perform private.app_error('invalid_request', 'export_first');
  end if;
  -- One reset at a time.
  perform pg_advisory_xact_lock(hashtext('admin_reset_test_data'));

  select count(*) into n_orders from public.orders;
  select count(*) into n_jobs from public.printing_jobs;
  select count(*) into n_customers from public.customers;
  select count(*) into n_accounts from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
  select count(*) into n_topups from public.wallet_topups;
  select count(*) into n_reviews from public.product_reviews;

  perform set_config('app.data_reset', 'on', true);
  perform set_config('app.audit_purge', 'on', true);

  -- ("where true": Supabase refuses DELETE without WHERE on API calls)
  delete from public.inventory_movements where order_id is not null;   -- stock levels stay as they are now
  delete from public.wallet_ledger where true;
  delete from public.wallet_topups where true;
  delete from public.product_reviews where true;
  delete from public.stock_alerts where true;
  delete from public.customer_carts where true;
  delete from public.push_subscriptions where true;
  delete from public.courier_notifications where true;  -- courier app (0070): before the orders they point to
  delete from public.courier_earnings where true;
  delete from public.courier_payouts where true;
  delete from public.partner_earnings where true;     -- partner shops (0073)
  delete from public.partner_payouts where true;
  delete from public.orders where true;                -- items, payments, history, notes
  delete from public.printing_jobs where true;         -- files, history
  delete from public.customers where true;             -- addresses
  delete from public.notifications_outbox where true;
  delete from public.rate_limits where true;
  delete from public.security_events where true;
  -- Before the accounts: their activity entries would otherwise need an (forbidden) update.
  delete from public.audit_logs where action not in ('audit_cleared', 'data_reset');
  get diagnostics n_audit = row_count;
  -- Customer sign-in accounts (staff are kept).
  delete from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);

  -- New numbering for the real shop.
  alter sequence public.order_number_seq restart with 10001;
  alter sequence public.print_job_number_seq restart with 10001;
  alter sequence public.wallet_topup_number_seq restart with 1001;

  perform set_config('app.data_reset', 'off', true);
  perform set_config('app.audit_purge', 'off', true);

  v_counts := jsonb_build_object('orders', n_orders, 'printing_jobs', n_jobs, 'customers', n_customers, 'customer_accounts', n_accounts,
                                 'wallet_topups', n_topups, 'reviews', n_reviews, 'activity_entries', n_audit, 'reset_at', now());
  perform private.audit('data_reset', 'data', null, null, null, v_counts);
  return v_counts;
end;
$$;
