-- =============================================================================
-- 0007 BUSINESS FUNCTIONS
-- All money, stock and status transitions happen here, inside transactions,
-- with row locks. The browser is never trusted for prices or totals.
--
-- Two families:
--   * Checkout functions  -> EXECUTE granted to service_role ONLY. Called by
--     Next.js server code after validation + rate limiting.
--   * admin_* functions   -> EXECUTE granted to authenticated; every one checks
--     the caller's permission with private.require_permission().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Automatic status history (note passed via transaction-local setting)
-- ---------------------------------------------------------------------------
create or replace function private.set_status_note(p_note text)
returns void
language sql
set search_path = ''
as $$ select set_config('app.status_note', coalesce(p_note, ''), true); $$;

create or replace function private.log_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status
     or new.payment_status is distinct from old.payment_status then
    insert into public.order_status_history
      (order_id, from_status, to_status, from_payment_status, to_payment_status, changed_by, note)
    values (new.id,
            case when tg_op = 'UPDATE' then old.status end, new.status,
            case when tg_op = 'UPDATE' then old.payment_status end, new.payment_status,
            (select auth.uid()),
            nullif(current_setting('app.status_note', true), ''));
  end if;
  return new;
end;
$$;
create trigger orders_status_history after insert or update of status, payment_status on public.orders
  for each row execute function private.log_order_status();

create or replace function private.log_printing_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.printing_job_history (job_id, from_status, to_status, changed_by, note)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            (select auth.uid()), nullif(current_setting('app.status_note', true), ''));
  end if;
  return new;
end;
$$;
create trigger printing_jobs_status_history after insert or update of status on public.printing_jobs
  for each row execute function private.log_printing_status();

-- ---------------------------------------------------------------------------
-- Settings accessor
-- ---------------------------------------------------------------------------
create or replace function private.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select value from public.website_settings where key = p_key), '{}'::jsonb) $$;

-- ---------------------------------------------------------------------------
-- Stock release (idempotent: releases only what is still reserved)
-- ---------------------------------------------------------------------------
create or replace function private.release_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_after integer;
begin
  for r in
    select m.product_id, -sum(m.change)::integer as reserved
    from public.inventory_movements m
    where m.order_id = p_order_id
    group by m.product_id
    having sum(m.change) < 0
    order by m.product_id
  loop
    update public.products set stock_quantity = stock_quantity + r.reserved
     where id = r.product_id
    returning stock_quantity into v_after;
    insert into public.inventory_movements (product_id, change, quantity_after, reason, order_id, actor_id)
    values (r.product_id, r.reserved, v_after, 'order_released', p_order_id, (select auth.uid()));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Printing price quote (single source of truth; mirrored in src/lib/pricing)
--   total = page_count * copies * price_per_page(color, size, sides) + service charge
-- ---------------------------------------------------------------------------
create or replace function public.quote_printing(
  p_color public.print_color_mode, p_paper_size text, p_sides public.print_sides,
  p_page_count integer, p_copies integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.printing_price_rules;
  v_charge numeric(10,2) := coalesce((private.setting('printing') ->> 'service_charge_etb')::numeric, 0);
begin
  if p_page_count is null or p_page_count < 1 or p_copies is null or p_copies < 1 then
    return null;
  end if;
  select * into v_rule from public.printing_price_rules
   where color_mode = p_color and paper_size = p_paper_size and sides = p_sides and is_active;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'price_per_page_etb', v_rule.price_per_page_etb,
    'service_charge_etb', v_charge,
    'total_etb', round(p_page_count * p_copies * v_rule.price_per_page_etb + v_charge, 2));
end;
$$;

-- ---------------------------------------------------------------------------
-- CHECKOUT: create order
-- p_input = {
--   idempotency_key, access_token_hash, tracking_code_hash, locale,
--   customer:    { full_name, phone },
--   fulfillment: { method, delivery_zone_id?, address_line?, instructions? },
--   items: [ { type:'product', product_id, quantity }
--          | { type:'printing', printing_job_id, access_token_hash } ]
-- }
-- ---------------------------------------------------------------------------
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
    bank_account_id, bank_snapshot, locale, payment_due_at)
  values (
    p_input ->> 'access_token_hash', p_input ->> 'tracking_code_hash', v_key, v_customer_id, v_name, v_phone,
    v_method, v_zone.id, case when v_method = 'delivery' then v_zone.name_en end, v_address, v_instr,
    v_subtotal, v_fee, 0, v_subtotal + v_fee,
    v_bank.id,
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
                            'total_etb', v_subtotal + v_fee, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- CHECKOUT: submit payment evidence (receipt already uploaded to private bucket)
-- p_input = { order_id, access_token_hash, transaction_reference?,
--             receipt: { path, mime, size, original_name, sha256 } }
-- ---------------------------------------------------------------------------
create or replace function public.submit_payment(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.orders;
  v_sub_id  uuid;
  v_resub   boolean;
  v_ref     text := nullif(btrim(coalesce(p_input ->> 'transaction_reference', '')), '');
  v_payload jsonb;
begin
  select * into v_order from public.orders
   where id = (p_input ->> 'order_id')::uuid
   for update;
  if not found or v_order.access_token_hash is distinct from p_input ->> 'access_token_hash' then
    perform private.app_error('order_not_found');
  end if;

  if v_order.status = 'pending_verification' then
    -- Idempotent retry of the same upload
    select id into v_sub_id from public.payment_submissions
     where order_id = v_order.id and status = 'pending' and receipt_sha256 = p_input #>> '{receipt,sha256}';
    if found then
      return jsonb_build_object('submission_id', v_sub_id, 'replayed', true);
    end if;
    perform private.app_error('payment_already_pending');
  end if;
  if v_order.status not in ('awaiting_payment', 'payment_rejected') then
    perform private.app_error('payment_not_allowed', v_order.status::text);
  end if;
  if v_order.payment_due_at < now() then
    perform private.app_error('order_expired');
  end if;

  v_resub := exists (select 1 from public.payment_submissions where order_id = v_order.id and status = 'rejected');

  insert into public.payment_submissions (order_id, transaction_reference, receipt_path, receipt_mime,
    receipt_size_bytes, receipt_original_name, receipt_sha256, amount_expected_etb)
  values (v_order.id, v_ref, p_input #>> '{receipt,path}', p_input #>> '{receipt,mime}',
    (p_input #>> '{receipt,size}')::integer, left(p_input #>> '{receipt,original_name}', 255),
    p_input #>> '{receipt,sha256}', v_order.total_etb)
  returning id into v_sub_id;

  perform private.set_status_note(case when v_resub then 'Payment resubmitted' else 'Payment submitted' end);
  update public.orders set status = 'pending_verification', payment_status = 'pending_verification'
   where id = v_order.id;
  update public.printing_jobs set status = 'payment_verification'
   where order_id = v_order.id and status = 'awaiting_payment';

  select jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number, 'submission_id', v_sub_id,
    'customer_name', v_order.customer_name, 'customer_phone', v_order.customer_phone,
    'items', (select jsonb_agg(jsonb_build_object('name', oi.name_en, 'quantity', oi.quantity) order by oi.created_at, oi.name_en)
                from public.order_items oi where oi.order_id = v_order.id),
    'total_etb', v_order.total_etb, 'transaction_reference', v_ref,
    'fulfillment_method', v_order.fulfillment_method, 'city', v_order.city,
    'address_line', v_order.address_line, 'resubmission', v_resub,
    'reference_seen_before', (v_ref is not null and exists (
        select 1 from public.payment_submissions s
         where lower(s.transaction_reference) = lower(v_ref) and s.id <> v_sub_id)))
  into v_payload;

  perform private.enqueue_notification(
    case when v_resub then 'payment_resubmitted' else 'new_order' end,
    'payment_submission:' || v_sub_id, v_payload, 'payment-receipts', p_input #>> '{receipt,path}');

  return jsonb_build_object('submission_id', v_sub_id, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- CHECKOUT: create printing job (files already uploaded under jobs/<id>/)
-- p_input = { id, access_token_hash, customer:{full_name, phone}, color_mode, paper_size,
--             sides, copies, fulfillment_method, customer_notes?,
--             files: [{ path, original_name, mime, size, sha256, page_count? }] }
-- ---------------------------------------------------------------------------
create or replace function public.create_printing_job(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := (p_input ->> 'id')::uuid;
  v_settings jsonb := private.setting('printing');
  v_pages    integer;
  v_unknown  boolean;
  v_quote    jsonb;
  v_job      public.printing_jobs;
  f          jsonb;
begin
  if jsonb_typeof(p_input -> 'files') <> 'array' or jsonb_array_length(p_input -> 'files') not between 1 and 10 then
    perform private.app_error('invalid_files');
  end if;
  if (p_input ->> 'copies')::integer > coalesce((v_settings ->> 'max_copies')::integer, 500) then
    perform private.app_error('too_many_copies');
  end if;

  select bool_or(e ->> 'page_count' is null), sum((e ->> 'page_count')::integer)
    into v_unknown, v_pages
    from jsonb_array_elements(p_input -> 'files') e;
  if v_unknown then v_pages := null; end if;

  perform private.set_status_note('Request received');
  insert into public.printing_jobs (id, access_token_hash, customer_name, customer_phone, color_mode,
    paper_size, sides, copies, page_count, page_count_source, fulfillment_method, customer_notes,
    files_delete_after)
  values (v_id, p_input ->> 'access_token_hash', btrim(p_input #>> '{customer,full_name}'),
    p_input #>> '{customer,phone}', (p_input ->> 'color_mode')::public.print_color_mode,
    p_input ->> 'paper_size', (p_input ->> 'sides')::public.print_sides, (p_input ->> 'copies')::integer,
    v_pages, case when v_pages is not null then 'auto' end,
    coalesce((p_input ->> 'fulfillment_method')::public.fulfillment_method, 'pickup'),
    nullif(btrim(coalesce(p_input ->> 'customer_notes', '')), ''),
    now() + make_interval(days => coalesce((v_settings ->> 'retention_days')::integer, 30)))
  returning * into v_job;

  for f in select * from jsonb_array_elements(p_input -> 'files') loop
    if f ->> 'path' not like 'jobs/' || v_id::text || '/%' then
      perform private.app_error('invalid_files');
    end if;
    insert into public.printing_files (job_id, storage_path, original_name, mime_type, size_bytes, sha256, page_count)
    values (v_id, f ->> 'path', left(f ->> 'original_name', 255), f ->> 'mime', (f ->> 'size')::bigint,
            f ->> 'sha256', (f ->> 'page_count')::integer);
  end loop;

  v_quote := public.quote_printing(v_job.color_mode, v_job.paper_size, v_job.sides, v_pages, v_job.copies);

  if v_quote is not null then
    perform private.set_status_note('Priced automatically');
    update public.printing_jobs
       set price_per_page_etb = (v_quote ->> 'price_per_page_etb')::numeric,
           service_charge_etb = (v_quote ->> 'service_charge_etb')::numeric,
           estimated_total_etb = (v_quote ->> 'total_etb')::numeric,
           total_etb = (v_quote ->> 'total_etb')::numeric,
           status = 'awaiting_payment'
     where id = v_id returning * into v_job;
  else
    perform private.set_status_note('Needs a manual quote');
    update public.printing_jobs set status = 'awaiting_quote' where id = v_id returning * into v_job;
  end if;

  perform private.enqueue_notification('printing_request', 'printing_job:' || v_id,
    jsonb_build_object('job_id', v_id, 'job_number', v_job.job_number,
      'customer_name', v_job.customer_name, 'customer_phone', v_job.customer_phone,
      'color_mode', v_job.color_mode, 'paper_size', v_job.paper_size, 'sides', v_job.sides,
      'copies', v_job.copies, 'page_count', v_job.page_count, 'total_etb', v_job.total_etb,
      'status', v_job.status, 'file_count', jsonb_array_length(p_input -> 'files')));

  return jsonb_build_object('job_id', v_id, 'job_number', v_job.job_number,
                            'status', v_job.status, 'total_etb', v_job.total_etb);
end;
$$;

-- ---------------------------------------------------------------------------
-- MAINTENANCE: expire unpaid orders and release their stock (cron, service_role)
-- ---------------------------------------------------------------------------
create or replace function public.expire_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  perform private.set_status_note('Payment window elapsed');
  for v_id in
    select id from public.orders
     where status in ('awaiting_payment', 'payment_rejected') and payment_due_at < now()
     order by payment_due_at
     limit 500
     for update skip locked
  loop
    perform private.release_order_stock(v_id);
    update public.orders set status = 'expired' where id = v_id;
    -- Free printing jobs so the customer can pay for them in a new order
    update public.printing_jobs set order_id = null, status = 'awaiting_payment'
     where order_id = v_id and status = 'awaiting_payment';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- ADMIN: review a payment submission
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_payment(p_submission_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub   public.payment_submissions;
  v_order public.orders;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require_permission('payments.verify');

  select * into v_sub from public.payment_submissions where id = p_submission_id;
  if not found then perform private.app_error('not_found'); end if;
  -- Lock order first, then submission (same order everywhere)
  select * into v_order from public.orders where id = v_sub.order_id for update;
  select * into v_sub from public.payment_submissions where id = p_submission_id for update;

  if v_sub.status <> 'pending' or v_order.status <> 'pending_verification' then
    perform private.app_error('already_reviewed');
  end if;

  if p_decision = 'verified' then
    update public.payment_submissions
       set status = 'verified', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = v_note
     where id = v_sub.id;
    perform private.set_status_note(coalesce(v_note, 'Payment verified'));
    update public.orders
       set status = 'confirmed', payment_status = 'verified',
           payment_verified_at = now(), payment_verified_by = (select auth.uid())
     where id = v_order.id;
    update public.printing_jobs set status = 'printing'
     where order_id = v_order.id and status = 'payment_verification';
  elsif p_decision = 'rejected' then
    if v_note is null then perform private.app_error('note_required'); end if;
    update public.payment_submissions
       set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = v_note
     where id = v_sub.id;
    perform private.set_status_note(v_note);
    update public.orders
       set status = 'payment_rejected', payment_status = 'rejected',
           payment_due_at = greatest(payment_due_at, now() + make_interval(
             hours => coalesce((private.setting('delivery') ->> 'payment_window_hours')::integer, 24)))
     where id = v_order.id;
    update public.printing_jobs set status = 'awaiting_payment'
     where order_id = v_order.id and status = 'payment_verification';
  else
    perform private.app_error('invalid_decision');
  end if;

  perform private.audit('payment_' || p_decision, 'payment_submission', v_sub.id::text,
    jsonb_build_object('status', v_sub.status), jsonb_build_object('status', p_decision, 'note', v_note),
    jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number));

  perform private.enqueue_notification('payment_' || p_decision, 'payment_review:' || v_sub.id,
    jsonb_build_object('order_number', v_order.order_number, 'total_etb', v_order.total_etb,
                       'decision', p_decision, 'note', v_note, 'reviewer', private.current_role_key()));
end;
$$;

-- ---------------------------------------------------------------------------
-- ADMIN: order status transitions (state machine)
-- ---------------------------------------------------------------------------
create or replace function private.can_view_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('orders.view_all')
      or (private.has_permission('orders.view_assigned') and exists (
            select 1 from public.orders o where o.id = p_order_id and o.assigned_to = (select auth.uid())))
$$;
grant execute on function private.can_view_order(uuid) to authenticated;

create or replace function public.admin_update_order_status(p_order_id uuid, p_status public.order_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_ok    boolean;
begin
  if not private.can_view_order(p_order_id) then perform private.app_error('not_found'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then perform private.app_error('not_found'); end if;

  v_ok := case
    when p_status = 'cancelled' then v_order.status in
      ('awaiting_payment', 'payment_rejected', 'pending_verification', 'confirmed', 'processing')
    when v_order.status = 'confirmed' then p_status = 'processing'
    when v_order.status = 'processing' then
      (p_status = 'ready_for_pickup' and v_order.fulfillment_method = 'pickup')
      or (p_status = 'out_for_delivery' and v_order.fulfillment_method = 'delivery')
    when v_order.status = 'ready_for_pickup' then p_status = 'completed'
    when v_order.status = 'out_for_delivery' then p_status in ('completed', 'processing')
    else false
  end;
  if not v_ok then
    perform private.app_error('invalid_transition', v_order.status::text || '->' || p_status::text);
  end if;

  if p_status = 'cancelled' then
    perform private.require_permission('orders.manage');
    if v_note is null then perform private.app_error('note_required'); end if;
    perform private.release_order_stock(v_order.id);
    update public.printing_jobs set status = 'cancelled'
     where order_id = v_order.id and status not in ('completed', 'cancelled');
    perform private.enqueue_notification('order_cancelled', 'order_cancelled:' || v_order.id,
      jsonb_build_object('order_number', v_order.order_number, 'note', v_note,
                         'refund_required', v_order.payment_status = 'verified'));
  elsif not (private.has_permission('orders.manage') or private.has_permission('orders.update_fulfillment')) then
    perform private.app_error('forbidden', 'orders.update_fulfillment');
  end if;

  perform private.set_status_note(v_note);
  update public.orders
     set status = p_status,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
   where id = v_order.id;

  perform private.audit('order_status', 'order', v_order.id::text,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', p_status, 'note', v_note));
end;
$$;

create or replace function public.admin_assign_order(p_order_id uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('orders.manage');
  if p_assignee is not null and not exists (
    select 1 from public.profiles where id = p_assignee and is_active) then
    perform private.app_error('invalid_assignee');
  end if;
  update public.orders set assigned_to = p_assignee where id = p_order_id;
  if not found then perform private.app_error('not_found'); end if;
  perform private.audit('order_assign', 'order', p_order_id::text, null,
                        jsonb_build_object('assigned_to', p_assignee));
end;
$$;

-- ---------------------------------------------------------------------------
-- ADMIN: stock adjustment
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_stock(
  p_product_id uuid, p_change integer, p_reason public.inventory_reason, p_note text default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after integer;
begin
  perform private.require_permission('inventory.manage');
  if p_reason not in ('restock', 'adjustment', 'damage', 'return') then
    perform private.app_error('invalid_reason');
  end if;
  if p_change is null or p_change = 0 or abs(p_change) > 100000 then
    perform private.app_error('invalid_quantity');
  end if;
  update public.products set stock_quantity = stock_quantity + p_change, updated_by = (select auth.uid())
   where id = p_product_id and stock_quantity + p_change >= 0
  returning stock_quantity into v_after;
  if not found then
    if exists (select 1 from public.products where id = p_product_id) then
      perform private.app_error('insufficient_stock');
    end if;
    perform private.app_error('not_found');
  end if;
  insert into public.inventory_movements (product_id, change, quantity_after, reason, note, actor_id)
  values (p_product_id, p_change, v_after, p_reason, left(p_note, 500), (select auth.uid()));
  return v_after;
end;
$$;

-- ---------------------------------------------------------------------------
-- ADMIN: printing jobs
-- ---------------------------------------------------------------------------
create or replace function public.admin_quote_printing_job(
  p_job_id uuid, p_page_count integer, p_total_etb numeric default null, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job   public.printing_jobs;
  v_quote jsonb;
begin
  perform private.require_permission('printing.manage');
  select * into v_job from public.printing_jobs where id = p_job_id for update;
  if not found then perform private.app_error('not_found'); end if;
  if v_job.status not in ('submitted', 'awaiting_quote', 'awaiting_payment') or v_job.order_id is not null then
    perform private.app_error('invalid_transition');
  end if;
  if p_page_count is null or p_page_count not between 1 and 5000 then
    perform private.app_error('invalid_page_count');
  end if;

  v_quote := public.quote_printing(v_job.color_mode, v_job.paper_size, v_job.sides, p_page_count, v_job.copies);
  if p_total_etb is null and v_quote is null then perform private.app_error('no_price_rule'); end if;
  if p_total_etb is not null and (p_total_etb <= 0 or p_total_etb > 1000000) then
    perform private.app_error('invalid_amount');
  end if;

  perform private.set_status_note(coalesce(nullif(btrim(p_note), ''), 'Quote issued'));
  update public.printing_jobs
     set page_count = p_page_count, page_count_source = 'admin',
         price_per_page_etb = (v_quote ->> 'price_per_page_etb')::numeric,
         service_charge_etb = coalesce((v_quote ->> 'service_charge_etb')::numeric, 0),
         total_etb = round(coalesce(p_total_etb, (v_quote ->> 'total_etb')::numeric), 2),
         quoted_by = (select auth.uid()), quoted_at = now(),
         status = 'awaiting_payment'
   where id = p_job_id returning * into v_job;

  perform private.audit('printing_quote', 'printing_job', p_job_id::text, null,
    jsonb_build_object('page_count', p_page_count, 'total_etb', v_job.total_etb));
  return jsonb_build_object('total_etb', v_job.total_etb);
end;
$$;

create or replace function public.admin_update_printing_status(
  p_job_id uuid, p_status public.print_job_status, p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.printing_jobs;
  v_order_status public.order_status;
  v_ok boolean;
begin
  perform private.require_permission('printing.manage');
  select * into v_job from public.printing_jobs where id = p_job_id for update;
  if not found then perform private.app_error('not_found'); end if;

  v_ok := case
    when p_status = 'cancelled' then v_job.status in ('submitted', 'awaiting_quote', 'awaiting_payment')
    when v_job.status = 'printing' then p_status = 'ready'
    when v_job.status = 'ready' then p_status in ('completed', 'printing')
    else false
  end;
  if not v_ok then
    perform private.app_error('invalid_transition', v_job.status::text || '->' || p_status::text);
  end if;
  if p_status = 'cancelled' and v_job.order_id is not null then
    select status into v_order_status from public.orders where id = v_job.order_id;
    if v_order_status not in ('cancelled', 'expired') then
      perform private.app_error('cancel_order_instead');
    end if;
  end if;

  perform private.set_status_note(p_note);
  update public.printing_jobs set status = p_status where id = p_job_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- ADMIN: staff role management (no self-escalation, never lose last super admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_staff_role(p_user_id uuid, p_role_key text, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role smallint;
  v_super smallint;
begin
  perform private.require_permission('staff.manage');
  if p_user_id = (select auth.uid()) then perform private.app_error('cannot_modify_self'); end if;
  select id into v_role from public.admin_roles where key = p_role_key;
  if not found then perform private.app_error('invalid_role'); end if;
  select id into v_super from public.admin_roles where key = 'super_admin';

  perform pg_advisory_xact_lock(hashtext('staff_roles'));
  update public.profiles set role_id = v_role, is_active = p_is_active where id = p_user_id;
  if not found then perform private.app_error('not_found'); end if;
  if not exists (select 1 from public.profiles where role_id = v_super and is_active) then
    perform private.app_error('last_super_admin');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.effective_price(public.products) to anon, authenticated, service_role;
grant execute on function public.my_admin_context() to authenticated;
grant execute on function public.quote_printing(public.print_color_mode, text, public.print_sides, integer, integer)
  to authenticated, service_role;

grant execute on function public.create_order(jsonb) to service_role;
grant execute on function public.submit_payment(jsonb) to service_role;
grant execute on function public.create_printing_job(jsonb) to service_role;
grant execute on function public.expire_unpaid_orders() to service_role;
grant execute on function public.claim_notifications(integer) to service_role;
grant execute on function public.complete_notification(bigint, boolean, text) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.bootstrap_super_admin(uuid, text) to service_role;

grant execute on function public.admin_review_payment(uuid, text, text) to authenticated;
grant execute on function public.admin_update_order_status(uuid, public.order_status, text) to authenticated;
grant execute on function public.admin_assign_order(uuid, uuid) to authenticated;
grant execute on function public.admin_adjust_stock(uuid, integer, public.inventory_reason, text) to authenticated;
grant execute on function public.admin_quote_printing_job(uuid, integer, numeric, text) to authenticated;
grant execute on function public.admin_update_printing_status(uuid, public.print_job_status, text) to authenticated;
grant execute on function public.admin_set_staff_role(uuid, text, boolean) to authenticated;
