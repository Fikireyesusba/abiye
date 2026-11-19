-- =============================================================================
-- 0019 FINALIZATION
--   * Promotion codes are redeemable at checkout. The discount is computed
--     ONLY here (private.apply_promotion), inside create_order, from database
--     prices. Optional usage limit and once-per-customer.
--   * Codes are no longer readable by the public API unless the promotion is
--     shown on the homepage (private codes cannot be enumerated).
--   * admin_analytics(): sales over time, by category, best sellers, status
--     distribution, payments, inventory, promotions, printing.
--   * storage_orphans(): customer uploads that were never attached (sweep).
-- =============================================================================

alter table public.promotions
  add column max_redemptions   integer check (max_redemptions > 0),
  add column once_per_customer boolean not null default true;

drop policy promotions_public_read on public.promotions;
create policy promotions_public_read on public.promotions for select to anon, authenticated
  using (is_active and show_on_homepage
         and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));

-- p_lines: create_order lines [{item_type, product_id, unit, qty}, ...]
-- Eligible amount = product lines matching the promotion's product / category
-- (incl. subcategories); printing jobs are never discounted.
create or replace function private.apply_promotion(
  p_code text, p_lines jsonb, p_subtotal numeric, p_fee numeric, p_user uuid, p_lock boolean)
returns table (promotion_id uuid, discount_etb numeric, title_en text, title_am text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.promotions;
  v_code   text := lower(btrim(coalesce(p_code, '')));
  v_amount numeric(12,2);
  v_disc   numeric(12,2);
begin
  if v_code !~ '^[a-z0-9_-]{3,30}$' then perform private.app_error('invalid_promo_code'); end if;
  if p_lock then
    select * into v from public.promotions p where lower(p.code::text) = v_code for update;
  else
    select * into v from public.promotions p where lower(p.code::text) = v_code;
  end if;
  if not found or not v.is_active
     or (v.starts_at is not null and v.starts_at > now())
     or (v.ends_at is not null and v.ends_at <= now()) then
    perform private.app_error('invalid_promo_code');
  end if;
  if p_subtotal < v.min_order_etb then
    perform private.app_error('promo_min_order', v.min_order_etb::text);
  end if;

  select coalesce(sum((l ->> 'unit')::numeric * (l ->> 'qty')::integer), 0) into v_amount
    from jsonb_array_elements(p_lines) l
    left join public.products pr on pr.id = (l ->> 'product_id')::uuid
    left join public.categories c on c.id = pr.category_id
   where l ->> 'item_type' = 'product'
     and (v.product_id is null or pr.id = v.product_id)
     and (v.category_id is null or pr.category_id = v.category_id or c.parent_id = v.category_id);
  if v_amount <= 0 then perform private.app_error('promo_not_applicable'); end if;

  if v.max_redemptions is not null and (
       select count(*) from public.orders o
        where o.promotion_id = v.id and o.status not in ('expired', 'cancelled')) >= v.max_redemptions then
    perform private.app_error('promo_limit_reached');
  end if;
  if v.once_per_customer and p_user is not null and exists (
       select 1 from public.orders o
        where o.promotion_id = v.id and o.user_id = p_user and o.status not in ('expired', 'cancelled')) then
    perform private.app_error('promo_already_used');
  end if;

  v_disc := case when v.discount_type = 'percent' then round(v_amount * v.discount_value / 100, 2)
                 else least(v.discount_value, v_amount) end;
  v_disc := least(v_disc, p_subtotal + p_fee - 1); -- an order always costs at least 1 ETB
  if v_disc <= 0 then perform private.app_error('promo_not_applicable'); end if;
  return query select v.id, v_disc, v.title_en, v.title_am;
end;
$$;

-- Checkout preview (server only, rate limited by the app). Same rules as
-- create_order; delivery fee excluded (shown separately).
create or replace function public.quote_promotion(p_code text, p_items jsonb, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lines    jsonb := '[]'::jsonb;
  v_subtotal numeric(12,2) := 0;
  r          record;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    perform private.app_error('invalid_cart');
  end if;
  for r in
    select p.id, coalesce(p.sale_price_etb, p.price_etb) as unit, sum((e ->> 'quantity')::integer)::integer as qty
      from jsonb_array_elements(p_items) e
      join public.products p on p.id = (e ->> 'product_id')::uuid and p.status = 'active'
     where e ->> 'type' = 'product' and coalesce(e ->> 'quantity', '') ~ '^[0-9]{1,3}$'
       and coalesce(e ->> 'product_id', '') ~ '^[0-9a-f-]{36}$'
     group by p.id
  loop
    v_subtotal := v_subtotal + r.unit * r.qty;
    v_lines := v_lines || jsonb_build_object('item_type', 'product', 'product_id', r.id, 'unit', r.unit, 'qty', r.qty);
  end loop;
  v_subtotal := v_subtotal + coalesce((
    select sum(j.total_etb) from public.printing_jobs j
     where j.user_id = p_user_id and j.status = 'awaiting_payment' and j.order_id is null
       and j.id in (select (e ->> 'printing_job_id')::uuid from jsonb_array_elements(p_items) e
                     where e ->> 'type' = 'printing' and coalesce(e ->> 'printing_job_id', '') ~ '^[0-9a-f-]{36}$')), 0);
  return (select to_jsonb(q) from private.apply_promotion(p_code, v_lines, v_subtotal, 0, p_user_id, false) q);
end;
$$;

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
  v_promo_code  text := nullif(btrim(coalesce(p_input ->> 'promotion_code', '')), '');
  v_promo       record;
  v_promo_id    uuid;
  v_discount    numeric(12,2) := 0;
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
  if v_method = 'pickup' then
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
    v_fee := v_zone.fee_etb;
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
    subtotal_etb, delivery_fee_etb, discount_etb, total_etb,
    promotion_id, bank_account_id, bank_snapshot, locale, payment_due_at)
  values (
    p_input ->> 'access_token_hash', p_input ->> 'tracking_code_hash', v_key, v_customer_id, v_name, v_phone,
    v_method, v_zone.id, case when v_method = 'delivery' then v_zone.name_en end, v_address, v_instr,
    v_subtotal, v_fee, v_discount, v_subtotal + v_fee - v_discount,
    v_promo_id, v_bank.id,
    jsonb_build_object('bank_name', v_bank.bank_name, 'account_holder', v_bank.account_holder,
                       'account_number', v_bank.account_number, 'branch', v_bank.branch,
                       'instructions_en', v_bank.instructions_en, 'instructions_am', v_bank.instructions_am),
    case when p_input ->> 'locale' = 'am' then 'am' else 'en' end,
    now() + make_interval(hours => coalesce((v_delivery ->> 'payment_window_hours')::integer, 24)))
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

-- ---------------------------------------------------------------------------
-- Analytics (calendar days in Africa/Addis_Ababa)
--   reports.operational: order counts, statuses, best sellers by quantity, inventory
--   analytics.view:      + all money figures
-- ---------------------------------------------------------------------------
create or replace function public.admin_analytics(p_from date, p_to date, p_bucket text default 'day')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_money  boolean := private.has_permission('analytics.view');
  v_bucket text := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end;
  v_from   timestamptz;
  v_to     timestamptz;
  v_result jsonb;
begin
  if not (v_money or private.has_permission('reports.operational')) then
    perform private.app_error('forbidden', 'analytics.view');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    perform private.app_error('invalid_request');
  end if;
  v_from := p_from::timestamp at time zone 'Africa/Addis_Ababa';
  v_to   := (p_to + 1)::timestamp at time zone 'Africa/Addis_Ababa';

  with
  placed as (select * from public.orders where created_at >= v_from and created_at < v_to),
  paid as (select * from public.orders where payment_status = 'verified'
                    and payment_verified_at >= v_from and payment_verified_at < v_to),
  paid_items as (
    select i.*, p.category_id, coalesce(c.parent_id, c.id) as top_category
      from public.order_items i join paid o on o.id = i.order_id
      left join public.products p on p.id = i.product_id
      left join public.categories c on c.id = p.category_id),
  buckets as (
    select generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval)::date as b)
  select jsonb_build_object(
    'money', v_money,
    'bucket', v_bucket,
    'totals', jsonb_build_object(
      'orders_placed', (select count(*) from placed),
      'orders_paid', (select count(*) from paid),
      'orders_expired', (select count(*) from placed where status = 'expired'),
      'orders_cancelled', (select count(*) from placed where status = 'cancelled'),
      'items_sold', (select coalesce(sum(quantity), 0) from paid_items where item_type = 'product'),
      'revenue', case when v_money then (select coalesce(sum(total_etb), 0) from paid) end,
      'products_revenue', case when v_money then (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'product') end,
      'printing_revenue', case when v_money then (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'printing') end,
      'delivery_fees', case when v_money then (select coalesce(sum(delivery_fee_etb), 0) from paid) end,
      'discounts', case when v_money then (select coalesce(sum(discount_etb), 0) from paid) end,
      'average_order', case when v_money then (select round(avg(total_etb), 2) from paid) end),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', bk.b,
               'orders', (select count(*) from placed o
                           where date_trunc(v_bucket, (o.created_at at time zone 'Africa/Addis_Ababa'))::date = bk.b),
               'paid', (select count(*) from paid o
                         where date_trunc(v_bucket, (o.payment_verified_at at time zone 'Africa/Addis_Ababa'))::date = bk.b),
               'revenue', case when v_money then (select coalesce(sum(o.total_etb), 0) from paid o
                         where date_trunc(v_bucket, (o.payment_verified_at at time zone 'Africa/Addis_Ababa'))::date = bk.b) end)
             order by bk.b), '[]'::jsonb)
        from buckets bk),
    'by_category', (
      select coalesce(jsonb_agg(x order by x.qty desc), '[]'::jsonb) from (
        select coalesce(c.name_en, case when pi.item_type = 'printing' then 'Printing services' else 'Other' end) as name,
               coalesce(c.department::text, case when pi.item_type = 'printing' then 'printing' end) as department,
               sum(pi.quantity) as qty,
               case when v_money then sum(pi.line_total_etb) end as revenue
          from paid_items pi left join public.categories c on c.id = pi.top_category
         group by 1, 2) x),
    'best_sellers', (
      select coalesce(jsonb_agg(x order by x.qty desc, x.name), '[]'::jsonb) from (
        select pi.product_id, max(pi.name_en) as name, max(pi.sku) as sku, sum(pi.quantity) as qty,
               case when v_money then sum(pi.line_total_etb) end as revenue
          from paid_items pi where pi.item_type = 'product'
         group by pi.product_id
         order by sum(pi.quantity) desc
         limit 10) x),
    'statuses', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
        from (select status::text, count(*) as n from placed group by 1) s),
    'fulfillment', (
      select coalesce(jsonb_object_agg(fulfillment_method, n), '{}'::jsonb)
        from (select fulfillment_method::text, count(*) as n from placed group by 1) s),
    'promotions', (
      select coalesce(jsonb_agg(x order by x.orders desc), '[]'::jsonb) from (
        select pr.title_en as name, pr.code::text as code, count(*) as orders,
               case when v_money then sum(o.discount_etb) end as discount
          from placed o join public.promotions pr on pr.id = o.promotion_id
         where o.status not in ('expired', 'cancelled')
         group by pr.id) x),
    'inventory', jsonb_build_object(
      'active_products', (select count(*) from public.products where status = 'active'),
      'tracked', (select count(*) from public.products where status = 'active' and track_inventory),
      'out_of_stock', (select count(*) from public.products where status = 'active' and track_inventory and stock_quantity <= 0),
      'low_stock', (select count(*) from public.products where status = 'active' and track_inventory
                      and stock_quantity > 0 and stock_quantity <= low_stock_threshold),
      'units_in_stock', (select coalesce(sum(stock_quantity), 0) from public.products where status = 'active' and track_inventory),
      'stock_value', case when v_money then (select coalesce(sum(stock_quantity * coalesce(sale_price_etb, price_etb)), 0)
                       from public.products where status = 'active' and track_inventory) end)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer uploads that were never attached (signed upload URL used, form
-- abandoned). Older than p_min_age; deleted by the daily maintenance cron.
-- ---------------------------------------------------------------------------
create or replace function public.storage_orphans(p_min_age interval default '1 day', p_limit integer default 500)
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.created_at < now() - greatest(p_min_age, interval '6 hours')
     and (
       (o.bucket_id = 'payment-receipts'
          and not exists (select 1 from public.payment_submissions s where s.receipt_path = o.name))
       or (o.bucket_id = 'printing-files'
          and not exists (select 1 from public.printing_files f where f.storage_path = o.name)))
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

revoke execute on function public.quote_promotion(text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.admin_analytics(date, date, text) from public, anon;
revoke execute on function public.storage_orphans(interval, integer) from public, anon, authenticated;
grant execute on function public.quote_promotion(text, jsonb, uuid) to service_role;
grant execute on function public.admin_analytics(date, date, text) to authenticated;
grant execute on function public.storage_orphans(interval, integer) to service_role;
