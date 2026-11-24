-- =============================================================================
-- 0071 COURIERS & STAFF, PHASE 1
--   * Courier on / off duty is logged under "Courier" (no Telegram alert any more).
--   * Vehicle chosen by the admin: on foot, bicycle, motorcycle, car. Motorcycle / car need make, model,
--     plate number, insurance (company, policy number, expiry) and the courier's driving licence (number, expiry).
--   * HR details for every staff member (address, emergency contact, Fayda number, passport optional,
--     job title, start date) — only for staff.manage; never copied into the Activity log or Telegram.
--   * Ethiopian cities: added as delivery cities (switched off until the admin sets a price). Couriers choose
--     the cities they serve when going on duty; Dispatch shows who is available for the order's city.
--   * Delivery fee: discount steps by number of items (Super Admin, settings → delivery_discounts). The order
--     keeps the full city price (delivery_fee_full_etb) — that is what the courier earns.
--   * Couriers can decline an assigned delivery before pickup (reason; back to Dispatch; set off duty).
--   * Ringtone for the courier app (uploaded by the Super Admin; public "app-sounds" bucket).
--   * Excel of orders handled by couriers (Super Admin).
-- =============================================================================

-- ------------------------------------------------------------ vehicle, licence, insurance, cities served
alter table public.courier_profiles drop constraint if exists courier_profiles_vehicle_check;
update public.courier_profiles set vehicle = case vehicle when 'motorbike' then 'motorcycle' when 'other' then 'on_foot' else vehicle end;
alter table public.courier_profiles alter column vehicle drop not null;
alter table public.courier_profiles alter column vehicle set default null;
alter table public.courier_profiles add constraint courier_profiles_vehicle_check check (vehicle in ('on_foot', 'bicycle', 'motorcycle', 'car'));
alter table public.courier_profiles
  add column vehicle_make      text check (char_length(vehicle_make) <= 40),
  add column vehicle_model     text check (char_length(vehicle_model) <= 40),
  add column insurance_company text check (char_length(insurance_company) <= 80),
  add column insurance_policy  text check (char_length(insurance_policy) <= 40),
  add column insurance_expiry  date,
  add column licence_number    text check (char_length(licence_number) <= 30),
  add column licence_expiry    date,
  add column available_zone_ids uuid[] not null default '{}';

-- ------------------------------------------------------------ HR details (all staff)
create table public.staff_hr (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  address           text check (char_length(address) <= 300),
  city              text check (char_length(city) <= 80),
  emergency_name    text check (char_length(emergency_name) <= 120),
  emergency_phone   text check (emergency_phone ~ '^\+251[79][0-9]{8}$'),
  fayda_number      text check (fayda_number ~ '^[0-9]{12,16}$'),
  passport_number   text check (passport_number ~ '^[A-Z0-9]{6,12}$'),
  job_title         text check (char_length(job_title) <= 80),
  start_date        date,
  notes             text check (char_length(notes) <= 1000),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null
);
alter table public.staff_hr enable row level security;
revoke all on public.staff_hr from anon, authenticated;
grant select on public.staff_hr to authenticated;
create policy staff_hr_read on public.staff_hr for select to authenticated
  using ((select private.has_permission('staff.manage')) or profile_id = (select auth.uid()));

create or replace function public.admin_save_staff_hr(p_profile uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('staff.manage');
  if not exists (select 1 from public.profiles where id = p_profile) then perform private.app_error('not_found'); end if;
  insert into public.staff_hr (profile_id, address, city, emergency_name, emergency_phone, fayda_number, passport_number, job_title, start_date, notes, updated_at, updated_by)
  values (p_profile, nullif(btrim(p ->> 'address'), ''), nullif(btrim(p ->> 'city'), ''), nullif(btrim(p ->> 'emergency_name'), ''),
          nullif(p ->> 'emergency_phone', ''), nullif(p ->> 'fayda_number', ''), nullif(upper(p ->> 'passport_number'), ''),
          nullif(btrim(p ->> 'job_title'), ''), nullif(p ->> 'start_date', '')::date, nullif(btrim(p ->> 'notes'), ''), now(), auth.uid())
  on conflict (profile_id) do update set
    address = excluded.address, city = excluded.city, emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone,
    fayda_number = excluded.fayda_number, passport_number = excluded.passport_number, job_title = excluded.job_title,
    start_date = excluded.start_date, notes = excluded.notes, updated_at = now(), updated_by = auth.uid();
  -- Logged without the values (ID numbers stay out of the Activity log and Telegram).
  perform private.audit('staff_hr_updated', 'staff_hr', p_profile::text, null, null, jsonb_build_object('user_id', private.member_of(p_profile)));
end;
$$;

-- ------------------------------------------------------------ Ethiopian cities (as delivery cities, off until priced)
insert into public.delivery_zones (name_en, name_am, fee_etb, is_active, sort_order)
select v.en, v.am, 0, false, 1000 + v.n from (values
  (1,'Addis Ababa','አዲስ አበባ'),(2,'Adama','አዳማ'),(3,'Bishoftu','ቢሾፍቱ'),(4,'Hawassa','ሐዋሳ'),(5,'Bahir Dar','ባሕር ዳር'),(6,'Gondar','ጎንደር'),
  (7,'Mekelle','መቀሌ'),(8,'Dire Dawa','ድሬ ዳዋ'),(9,'Harar','ሐረር'),(10,'Jijiga','ጅጅጋ'),(11,'Jimma','ጅማ'),(12,'Dessie','ደሴ'),
  (13,'Kombolcha','ኮምቦልቻ'),(14,'Shashemene','ሻሸመኔ'),(15,'Arba Minch','አርባ ምንጭ'),(16,'Wolaita Sodo','ወላይታ ሶዶ'),(17,'Hosaena','ሆሳዕና'),
  (18,'Dilla','ዲላ'),(19,'Debre Birhan','ደብረ ብርሃን'),(20,'Debre Markos','ደብረ ማርቆስ'),(21,'Debre Tabor','ደብረ ታቦር'),(22,'Nekemte','ነቀምቴ'),
  (23,'Asella','አሰላ'),(24,'Ambo','አምቦ'),(25,'Woldia','ወልዲያ'),(26,'Axum','አክሱም'),(27,'Adigrat','አዲግራት'),(28,'Shire','ሽሬ'),
  (29,'Adwa','አድዋ'),(30,'Gambela','ጋምቤላ'),(31,'Assosa','አሶሳ'),(32,'Semera','ሰመራ'),(33,'Robe','ሮቤ'),(34,'Goba','ጎባ'),
  (35,'Burayu','ቡራዩ'),(36,'Sebeta','ሰበታ'),(37,'Holeta','ሆለታ'),(38,'Mojo','ሞጆ'),(39,'Batu (Ziway)','ባቱ (ዝዋይ)'),(40,'Butajira','ቡታጅራ'),
  (41,'Welkite','ወልቂጤ'),(42,'Durame','ዱራሜ'),(43,'Mizan Teferi','ሚዛን ተፈሪ'),(44,'Bonga','ቦንጋ'),(45,'Metu','መቱ'),(46,'Gimbi','ጊምቢ'),
  (47,'Fiche','ፍቼ'),(48,'Dembi Dolo','ደምቢ ዶሎ'),(49,'Kemise','ከሚሴ'),(50,'Lalibela','ላሊበላ'),(51,'Bati','ባቲ'),(52,'Sekota','ሰቆጣ'),
  (53,'Finote Selam','ፍኖተ ሰላም'),(54,'Injibara','እንጅባራ'),(55,'Metema','መተማ'),(56,'Humera','ሑመራ'),(57,'Wukro','ውቅሮ'),(58,'Alamata','አላማጣ'),
  (59,'Chiro','ጭሮ'),(60,'Haramaya','ሐረማያ'),(61,'Dodola','ዶዶላ'),(62,'Negele Borana','ነገሌ ቦረና'),(63,'Moyale','ሞያሌ'),(64,'Yabelo','ያቤሎ'),
  (65,'Konso','ኮንሶ'),(66,'Jinka','ጂንካ'),(67,'Sawla','ሳውላ'),(68,'Tepi','ቴፒ'),(69,'Agaro','አጋሮ'),(70,'Bedele','በደሌ'),
  (71,'Shambu','ሻምቡ'),(72,'Kobo','ቆቦ'),(73,'Debre Sina','ደብረ ሲና'),(74,'Mota','ሞጣ'),(75,'Dangila','ዳንግላ'),(76,'Addis Zemen','አዲስ ዘመን'),
  (77,'Areka','አረካ'),(79,'Gode','ጎዴ'),(80,'Kebri Dahar','ቀብሪ ደሃር'),(81,'Degehabur','ደገሃቡር'),(82,'Asaita','አሳይታ'),
  (83,'Logia','ሎጊያ'),(84,'Bule Hora','ቡሌ ሆራ'),(85,'Hagere Mariam','ሐገረ ማርያም')) v(n, en, am)
on conflict (name_en) do nothing;

-- ------------------------------------------------------------ delivery fee: discount by number of items
alter table public.orders add column delivery_fee_full_etb numeric(12,2) check (delivery_fee_full_etb >= 0);
update public.orders set delivery_fee_full_etb = delivery_fee_etb where delivery_fee_full_etb is null and fulfillment_method = 'delivery';

-- Highest discount step reached by this many items (settings → delivery → delivery_discounts: [{min_items, percent}]).
create or replace function private.delivery_discount_pct(p_items integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(least(greatest((t ->> 'percent')::numeric, 0), 100)), 0)
    from jsonb_array_elements(coalesce(private.setting('delivery') -> 'delivery_discounts', '[]'::jsonb)) t
   where (t ->> 'min_items')::integer <= coalesce(p_items, 0)
$$;
revoke all on function private.delivery_discount_pct(integer) from public;

-- The order function: the same as before, with the item discount on the delivery fee and the full city price kept.
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
    -- Full city price (what the courier earns), then the Super Admin's discount for many items.
    v_fee_full := v_zone.fee_etb;
    v_fee := round(v_zone.fee_etb * (100 - private.delivery_discount_pct(
      (select coalesce(sum((l ->> 'qty')::integer), 0)::integer from jsonb_array_elements(v_lines) l))) / 100, 2);
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
-- ------------------------------------------------------------ courier: on duty with cities; own details = phone only
drop function if exists public.courier_set_duty(boolean);
create or replace function public.courier_set_duty(p_on boolean, p_zone_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zones uuid[] := coalesce((select array_agg(z.id) from public.delivery_zones z where z.id = any(coalesce(p_zone_ids, '{}')) and z.is_active), '{}');
begin
  perform private.require_permission('deliveries.own');
  if p_on and cardinality(v_zones) = 0 then perform private.app_error('invalid_request', 'cities'); end if;
  insert into public.courier_profiles (profile_id, on_duty, on_duty_since, available_zone_ids)
  values ((select auth.uid()), p_on, case when p_on then now() end, case when p_on then v_zones else '{}' end)
  on conflict (profile_id) do update set on_duty = excluded.on_duty, on_duty_since = excluded.on_duty_since,
    available_zone_ids = case when p_on then excluded.available_zone_ids else public.courier_profiles.available_zone_ids end;
  -- Logged under "Courier" (not a staff change): no Telegram alert.
  perform private.audit(case when p_on then 'courier_on_duty' else 'courier_off_duty' end, 'courier', (select auth.uid())::text);
end;
$$;

drop function if exists public.courier_update_details(text, text, text);
create or replace function public.courier_update_details(p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  insert into public.courier_profiles (profile_id, phone) values ((select auth.uid()), nullif(btrim(p_phone), ''))
  on conflict (profile_id) do update set phone = excluded.phone;
  perform private.audit('courier_details_updated', 'courier', (select auth.uid())::text);
end;
$$;

-- Admin: vehicle and documents (motorcycle / car need make, model, plate, insurance and driving licence).
drop function if exists public.admin_update_courier(uuid, text, text, text, numeric);
create or replace function public.admin_update_courier(p_courier uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle text := nullif(p ->> 'vehicle', '');
  v_motor boolean;
begin
  perform private.require_permission('couriers.manage');
  if not exists (select 1 from public.profiles pr join public.admin_roles r on r.id = pr.role_id where pr.id = p_courier and r.key = 'courier') then
    perform private.app_error('not_found');
  end if;
  if v_vehicle is not null and v_vehicle not in ('on_foot', 'bicycle', 'motorcycle', 'car') then perform private.app_error('invalid_request', 'vehicle'); end if;
  v_motor := v_vehicle in ('motorcycle', 'car');
  if v_motor and (coalesce(btrim(p ->> 'vehicle_make'), '') = '' or coalesce(btrim(p ->> 'vehicle_model'), '') = '' or coalesce(btrim(p ->> 'plate_number'), '') = ''
                  or coalesce(btrim(p ->> 'insurance_company'), '') = '' or coalesce(btrim(p ->> 'insurance_policy'), '') = '' or nullif(p ->> 'insurance_expiry', '') is null
                  or coalesce(btrim(p ->> 'licence_number'), '') = '' or nullif(p ->> 'licence_expiry', '') is null) then
    perform private.app_error('invalid_request', 'vehicle_documents');
  end if;
  insert into public.courier_profiles (profile_id) values (p_courier) on conflict (profile_id) do nothing;
  update public.courier_profiles set
    phone = nullif(p ->> 'phone', ''),
    vehicle = v_vehicle,
    vehicle_make = case when v_motor then btrim(p ->> 'vehicle_make') end,
    vehicle_model = case when v_motor then btrim(p ->> 'vehicle_model') end,
    plate_number = case when v_motor then upper(btrim(p ->> 'plate_number')) end,
    insurance_company = case when v_motor then btrim(p ->> 'insurance_company') end,
    insurance_policy = case when v_motor then btrim(p ->> 'insurance_policy') end,
    insurance_expiry = case when v_motor then (p ->> 'insurance_expiry')::date end,
    licence_number = case when v_motor then upper(btrim(p ->> 'licence_number')) end,
    licence_expiry = case when v_motor then (p ->> 'licence_expiry')::date end
  where profile_id = p_courier;
  perform private.audit('courier_details_updated', 'courier', p_courier::text, null, null, jsonb_build_object('vehicle', v_vehicle));
end;
$$;

create or replace function public.courier_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day timestamptz := date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
  v_month timestamptz := date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
begin
  perform private.require_permission('deliveries.own');
  return (
    select jsonb_build_object(
      'full_name', p.full_name, 'member_id', private.member_of(v_uid), 'email', (select email from auth.users where id = v_uid),
      'phone', cp.phone, 'vehicle', cp.vehicle, 'vehicle_make', cp.vehicle_make, 'vehicle_model', cp.vehicle_model, 'plate_number', cp.plate_number,
      'licence_expiry', cp.licence_expiry, 'insurance_expiry', cp.insurance_expiry,
      'on_duty', coalesce(cp.on_duty, false), 'on_duty_since', cp.on_duty_since,
      'cities', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name_en) order by z.name_en) from public.delivery_zones z
                           where z.id = any(coalesce(cp.available_zone_ids, '{}'))), '[]'::jsonb),
      'ringtone_path', private.setting('courier') ->> 'ringtone_path',
      'today_delivered', (select count(*) from public.courier_earnings e where e.courier_id = v_uid and e.earned_at >= v_day),
      'today_etb', (select coalesce(sum(amount_etb), 0) from public.courier_earnings e where e.courier_id = v_uid and e.earned_at >= v_day),
      'month_etb', (select coalesce(sum(amount_etb), 0) from public.courier_earnings e where e.courier_id = v_uid and e.earned_at >= v_month),
      'unpaid_etb', (select coalesce(sum(amount_etb), 0) from public.courier_earnings e where e.courier_id = v_uid and e.payout_id is null),
      'total_delivered', (select count(*) from public.courier_earnings e where e.courier_id = v_uid),
      'unread', (select count(*) from public.courier_notifications n where n.courier_id = v_uid and n.read_at is null),
      'latest_unread_assigned', (select max(n.id) from public.courier_notifications n where n.courier_id = v_uid and n.read_at is null and n.kind = 'assigned'),
      'active', (select count(*) from public.orders o where o.courier_id = v_uid and o.status in ('confirmed', 'processing', 'out_for_delivery')))
    from public.profiles p left join public.courier_profiles cp on cp.profile_id = p.id
    where p.id = v_uid);
end;
$$;

-- Cities the courier can choose (active delivery cities).
create or replace function public.courier_cities()
returns table (id uuid, name_en text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  return query select z.id, z.name_en from public.delivery_zones z where z.is_active order by z.sort_order, z.name_en;
end;
$$;

-- Courier declines a delivery before picking it up: back to Dispatch, courier set off duty (turn on again).
create or replace function public.courier_decline(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_courier uuid := v.courier_id;
begin
  if char_length(v_reason) not between 3 and 300 then perform private.app_error('invalid_reason'); end if;
  if v.status not in ('confirmed', 'processing') then perform private.app_error('invalid_transition'); end if;
  update public.orders set courier_id = null, courier_assigned_at = null, delivery_code_tries = 0 where id = v.id;
  update public.courier_profiles set on_duty = false, on_duty_since = null where profile_id = v_courier;
  perform private.audit('delivery_declined', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number, 'reason', v_reason));
  perform private.delivery_event(v, 'declined', jsonb_build_object('reason', v_reason));
end;
$$;

-- Delivered: the courier earns the full delivery price of the city (not the discounted one the customer paid).
create or replace function public.courier_deliver(p_order_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders := private.courier_order(p_order_id);
begin
  if v.status <> 'out_for_delivery' then perform private.app_error('invalid_transition'); end if;
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

-- ------------------------------------------------------------ admin lists
drop function if exists public.admin_couriers();
create function public.admin_couriers()
returns table (id uuid, member_id text, full_name text, email text, is_active boolean, phone text, vehicle text, vehicle_make text,
               vehicle_model text, plate_number text, insurance_company text, insurance_policy text, insurance_expiry date,
               licence_number text, licence_expiry date, on_duty boolean, on_duty_since timestamptz, zone_ids uuid[], cities text,
               active_deliveries bigint, delivered_month bigint, delivered_total bigint, failed_month bigint, declined_month bigint,
               unpaid_etb numeric, last_delivered_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month timestamptz := date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw';
  v_full boolean := private.has_permission('couriers.manage');
begin
  if not (v_full or private.has_permission('orders.manage')) then perform private.app_error('forbidden'); end if;
  return query
    select p.id, private.member_of(p.id), p.full_name, u.email::text, p.is_active, cp.phone, cp.vehicle,
           case when v_full then cp.vehicle_make end, case when v_full then cp.vehicle_model end, cp.plate_number,
           case when v_full then cp.insurance_company end, case when v_full then cp.insurance_policy end, case when v_full then cp.insurance_expiry end,
           case when v_full then cp.licence_number end, case when v_full then cp.licence_expiry end,
           coalesce(cp.on_duty, false), cp.on_duty_since, coalesce(cp.available_zone_ids, '{}'),
           (select string_agg(z.name_en, ', ' order by z.name_en) from public.delivery_zones z where z.id = any(coalesce(cp.available_zone_ids, '{}'))),
           (select count(*) from public.orders o where o.courier_id = p.id and o.status in ('confirmed', 'processing', 'out_for_delivery')),
           (select count(*) from public.courier_earnings e where e.courier_id = p.id and e.earned_at >= v_month),
           (select count(*) from public.courier_earnings e where e.courier_id = p.id),
           (select count(*) from public.audit_logs a where a.actor_id = p.id and a.action = 'delivery_failed' and a.created_at >= v_month),
           (select count(*) from public.audit_logs a where a.actor_id = p.id and a.action = 'delivery_declined' and a.created_at >= v_month),
           case when v_full then (select coalesce(sum(e.amount_etb), 0) from public.courier_earnings e where e.courier_id = p.id and e.payout_id is null) end,
           (select max(e.earned_at) from public.courier_earnings e where e.courier_id = p.id)
      from public.profiles p
      join public.admin_roles r on r.id = p.role_id and r.key = 'courier'
      join auth.users u on u.id = p.id
      left join public.courier_profiles cp on cp.profile_id = p.id
     where p.removed_at is null
     order by coalesce(cp.on_duty, false) desc, p.full_name;
end;
$$;

drop function if exists public.admin_dispatch_orders();
create function public.admin_dispatch_orders()
returns table (order_id uuid, order_number text, status text, zone_id uuid, city text, address_line text, total_etb numeric, paid_at timestamptz,
               courier_id uuid, delivery_attempts integer, fail_reason text, items integer, courier_pay_etb numeric, delivery_fee_etb numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('orders.manage');
  return query
    select o.id, o.order_number::text, o.status::text, o.delivery_zone_id, o.city, o.address_line, o.total_etb, o.payment_verified_at, o.courier_id,
           o.delivery_attempts, o.delivery_fail_reason, (select coalesce(sum(i.quantity), 0)::int from public.order_items i where i.order_id = o.id),
           coalesce(o.delivery_fee_full_etb, o.delivery_fee_etb), o.delivery_fee_etb
      from public.orders o
     where o.fulfillment_method = 'delivery' and o.status in ('confirmed', 'processing')
       and o.payment_status = 'verified'
       and (o.courier_id is null or o.delivery_failed_at is not null)
     order by o.payment_verified_at nulls last
     limit 200;
end;
$$;

-- ------------------------------------------------------------ ringtone
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-sounds', 'app-sounds', true, 2097152, array['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Writes only by the server (secret key) after the Super Admin check; read by everyone (public URL).

create or replace function public.admin_set_courier_ringtone(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('couriers.manage');
  if p_path is not null and p_path !~ '^ringtones/[0-9a-f-]{36}\.(mp3|ogg|wav|m4a)$' then perform private.app_error('invalid_request'); end if;
  insert into public.website_settings (key, value, is_public) values ('courier', jsonb_build_object('ringtone_path', p_path), false)
  on conflict (key) do update set value = case when p_path is null then public.website_settings.value - 'ringtone_path'
                                               else public.website_settings.value || jsonb_build_object('ringtone_path', p_path) end;
  perform private.audit('courier_ringtone_set', 'website_settings', 'courier', null, null, jsonb_build_object('set', p_path is not null));
end;
$$;

-- ------------------------------------------------------------ Excel: orders handled by couriers (Super Admin)
create or replace function public.admin_courier_orders(p_from timestamptz, p_to timestamptz, p_courier uuid default null)
returns table (order_number text, courier_user_id text, courier_name text, city text, status text, assigned_at timestamptz, picked_up_at timestamptz,
               delivered_at timestamptz, delivery_attempts integer, fail_reason text, delivery_fee_etb numeric, delivery_fee_full_etb numeric,
               order_total_etb numeric, courier_earned_etb numeric, paid_out_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('couriers.manage');
  return query
    select o.order_number::text, private.member_of(coalesce(e.courier_id, o.courier_id)), pr.full_name, o.city, o.status::text,
           o.courier_assigned_at, o.picked_up_at, o.delivered_at, o.delivery_attempts, o.delivery_fail_reason,
           o.delivery_fee_etb, o.delivery_fee_full_etb, o.total_etb, e.amount_etb, po.paid_at
      from public.orders o
      left join public.courier_earnings e on e.order_id = o.id
      left join public.courier_payouts po on po.id = e.payout_id
      left join public.profiles pr on pr.id = coalesce(e.courier_id, o.courier_id)
     where coalesce(e.courier_id, o.courier_id) is not null
       and (p_courier is null or coalesce(e.courier_id, o.courier_id) = p_courier)
       and coalesce(o.delivered_at, o.courier_assigned_at, o.created_at) >= p_from and coalesce(o.delivered_at, o.courier_assigned_at, o.created_at) < p_to
     order by coalesce(o.delivered_at, o.courier_assigned_at, o.created_at)
     limit 20000;
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
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;

revoke all on function public.admin_save_staff_hr(uuid, jsonb) from public, anon;
revoke all on function public.courier_set_duty(boolean, uuid[]) from public, anon;
revoke all on function public.courier_update_details(text) from public, anon;
revoke all on function public.admin_update_courier(uuid, jsonb) from public, anon;
revoke all on function public.courier_cities() from public, anon;
revoke all on function public.courier_decline(uuid, text) from public, anon;
revoke all on function public.admin_couriers() from public, anon;
revoke all on function public.admin_dispatch_orders() from public, anon;
revoke all on function public.admin_set_courier_ringtone(text) from public, anon;
revoke all on function public.admin_courier_orders(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.admin_save_staff_hr(uuid, jsonb) to authenticated;
grant execute on function public.courier_set_duty(boolean, uuid[]) to authenticated;
grant execute on function public.courier_update_details(text) to authenticated;
grant execute on function public.admin_update_courier(uuid, jsonb) to authenticated;
grant execute on function public.courier_cities() to authenticated;
grant execute on function public.courier_decline(uuid, text) to authenticated;
grant execute on function public.admin_couriers() to authenticated;
grant execute on function public.admin_dispatch_orders() to authenticated;
grant execute on function public.admin_set_courier_ringtone(text) to authenticated;
grant execute on function public.admin_courier_orders(timestamptz, timestamptz, uuid) to authenticated;
