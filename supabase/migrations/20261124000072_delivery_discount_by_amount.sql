-- =============================================================================
-- 0072: the delivery-fee discount steps go by PURCHASE AMOUNT instead of number of items.
--   settings → delivery → delivery_discounts: [{ "min_amount_etb": 5000, "percent": 10 }, { "min_amount_etb": 10000, "percent": 30 }]
--   The customer pays the city's delivery price minus the highest step reached by the order's products / printing
--   (before any promo code). The courier still earns the full city price.
-- =============================================================================

-- Old item-count steps are dropped (set the new steps in Settings → Delivery).
update public.website_settings set value = value || '{"delivery_discounts": []}'
 where key = 'delivery' and exists (select 1 from jsonb_array_elements(coalesce(value -> 'delivery_discounts', '[]'::jsonb)) t where t ? 'min_items');

create or replace function private.delivery_discount_pct_for_amount(p_subtotal numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(least(greatest((t ->> 'percent')::numeric, 0), 100)), 0)
    from jsonb_array_elements(coalesce(private.setting('delivery') -> 'delivery_discounts', '[]'::jsonb)) t
   where t ? 'min_amount_etb' and (t ->> 'min_amount_etb')::numeric <= coalesce(p_subtotal, 0)
$$;
revoke all on function private.delivery_discount_pct_for_amount(numeric) from public;
drop function if exists private.delivery_discount_pct(integer);

-- The order function: the same as before, with the discount by purchase amount.
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
    promotion_id, bank_account_id, bank_snapshot, locale, payment_due_at)
  values (
    p_input ->> 'access_token_hash', p_input ->> 'tracking_code_hash', v_key, v_customer_id, v_name, v_phone,
    v_method, v_zone.id, case when v_method = 'delivery' then v_zone.name_en end, v_address, v_instr,
    v_subtotal, v_fee, v_fee_full, v_discount, v_subtotal + v_fee - v_discount,
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
