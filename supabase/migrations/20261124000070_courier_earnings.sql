-- =============================================================================
-- 0070 COURIER APP: DETAILS, ON DUTY, EARNINGS (FIXED FEE), PAYOUTS, NOTIFICATIONS + ADMIN COURIERS
--   * courier_profiles: phone, vehicle, plate number, on duty; fee per delivery for this courier (optional).
--   * Fixed fee per delivered order (Admin → Couriers → Settings; default 100 ETB). Earned when the courier
--     delivers with the customer's code; paid out by the Super Admin ("Mark as paid") → payout record.
--   * Courier notifications (in the app): new delivery, delivery taken back, payment recorded.
--   * Admin (couriers.manage — Super Admin): couriers list, details, earnings, payouts, fee; dispatch list
--     of paid delivery orders without a courier (assigning still needs orders.manage).
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('couriers.manage', 'Manage couriers: details, fee per delivery, earnings and payouts')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'couriers.manage' from public.admin_roles r where r.key = 'super_admin'
on conflict do nothing;

insert into public.website_settings (key, value, is_public)
values ('courier', '{"fee_per_delivery_etb": 100}', false)
on conflict (key) do nothing;

create table public.courier_profiles (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  phone            text check (phone ~ '^\+251[79][0-9]{8}$'),
  vehicle          text not null default 'motorbike' check (vehicle in ('motorbike', 'bicycle', 'car', 'on_foot', 'other')),
  plate_number     text check (char_length(plate_number) <= 20),
  fee_override_etb numeric(10,2) check (fee_override_etb >= 0 and fee_override_etb <= 100000),
  on_duty          boolean not null default false,
  on_duty_since    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger courier_profiles_updated_at before update on public.courier_profiles
  for each row execute function private.set_updated_at();

create table public.courier_payouts (
  id             uuid primary key default gen_random_uuid(),
  courier_id     uuid not null references public.profiles(id) on delete restrict,
  amount_etb     numeric(12,2) not null check (amount_etb > 0),
  deliveries     integer not null check (deliveries > 0),
  reference      text check (char_length(reference) <= 80),
  note           text check (char_length(note) <= 300),
  paid_by        uuid references auth.users(id) on delete set null default auth.uid(),
  paid_at        timestamptz not null default now()
);
create index courier_payouts_courier_idx on public.courier_payouts (courier_id, paid_at desc);

create table public.courier_earnings (
  id          bigint generated always as identity primary key,
  courier_id  uuid not null references public.profiles(id) on delete restrict,
  order_id    uuid not null unique references public.orders(id) on delete restrict,
  order_number text not null,   -- shown to the courier (couriers cannot read the orders table)
  amount_etb  numeric(10,2) not null check (amount_etb >= 0),
  earned_at   timestamptz not null default now(),
  payout_id   uuid references public.courier_payouts(id) on delete restrict
);
create index courier_earnings_courier_idx on public.courier_earnings (courier_id, earned_at desc);
create index courier_earnings_unpaid_idx on public.courier_earnings (courier_id) where payout_id is null;

create table public.courier_notifications (
  id          bigint generated always as identity primary key,
  courier_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('assigned', 'unassigned', 'payout', 'message')),
  title       text not null check (char_length(title) <= 120),
  body        text check (char_length(body) <= 500),
  order_id    uuid references public.orders(id) on delete set null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index courier_notifications_courier_idx on public.courier_notifications (courier_id, id desc);

-- RLS: only through the functions below (couriers see their own rows; couriers.manage sees all).
alter table public.courier_profiles enable row level security;
alter table public.courier_payouts enable row level security;
alter table public.courier_earnings enable row level security;
alter table public.courier_notifications enable row level security;
revoke all on public.courier_profiles, public.courier_payouts, public.courier_earnings, public.courier_notifications from anon, authenticated;
grant select on public.courier_profiles, public.courier_payouts, public.courier_earnings, public.courier_notifications to authenticated;
create policy courier_profiles_read on public.courier_profiles for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.has_permission('couriers.manage')));
create policy courier_payouts_read on public.courier_payouts for select to authenticated
  using (courier_id = (select auth.uid()) or (select private.has_permission('couriers.manage')));
create policy courier_earnings_read on public.courier_earnings for select to authenticated
  using (courier_id = (select auth.uid()) or (select private.has_permission('couriers.manage')));
create policy courier_notifications_read on public.courier_notifications for select to authenticated
  using (courier_id = (select auth.uid()));

create or replace function private.courier_fee(p_courier uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select fee_override_etb from public.courier_profiles where profile_id = p_courier),
                  (private.setting('courier') ->> 'fee_per_delivery_etb')::numeric, 0)
$$;

create or replace function private.notify_courier(p_courier uuid, p_kind text, p_title text, p_body text, p_order uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.courier_notifications (courier_id, kind, title, body, order_id)
  select p_courier, p_kind, left(p_title, 120), left(p_body, 500), p_order where p_courier is not null
$$;

-- Assign / take back: also tells the courier(s) in the app.
create or replace function public.admin_assign_courier(p_order_id uuid, p_courier uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
  v_old uuid;
begin
  perform private.require_permission('orders.manage');
  select * into v from public.orders where id = p_order_id for update;
  if not found then perform private.app_error('not_found'); end if;
  if v.fulfillment_method <> 'delivery' then perform private.app_error('invalid_request', 'pickup order'); end if;
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
         delivery_code_tries = 0
   where id = v.id
  returning * into v;
  perform private.audit(case when p_courier is null then 'courier_unassigned' else 'courier_assigned' end, 'order', v.id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('order_number', v.order_number, 'courier_user_id', private.member_of(p_courier))));
  if v_old is not null and v_old is distinct from p_courier then
    perform private.notify_courier(v_old, 'unassigned', 'Delivery ' || v.order_number || ' was taken back', 'The office gave it to someone else or will deliver it another way.', v.id);
  end if;
  if p_courier is not null and v_old is distinct from p_courier then
    perform private.notify_courier(p_courier, 'assigned', 'New delivery: ' || v.order_number,
      coalesce(v.city, '') || coalesce(' — ' || v.address_line, ''), v.id);
  end if;
  if p_courier is not null then perform private.delivery_event(v, 'assigned'); end if;
end;
$$;

-- Delivered with the right code → earning recorded (fee at that moment).
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
  perform private.set_status_note('Delivered — customer''s code checked by the courier');
  update public.orders set status = 'completed', delivered_at = now() where id = v.id returning * into v;
  insert into public.courier_earnings (courier_id, order_id, order_number, amount_etb) values (v.courier_id, v.id, v.order_number, private.courier_fee(v.courier_id))
  on conflict (order_id) do nothing;
  perform private.audit('delivery_completed', 'order', v.id::text, null, null, jsonb_build_object('order_number', v.order_number));
  perform private.delivery_event(v, 'delivered');
  return true;
end;
$$;

-- ------------------------------------------------------------ courier app
create or replace function public.courier_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform private.require_permission('deliveries.own');
  return (
    select jsonb_build_object(
      'full_name', p.full_name, 'member_id', private.member_of(v_uid), 'email', (select email from auth.users where id = v_uid),
      'phone', cp.phone, 'vehicle', coalesce(cp.vehicle, 'motorbike'), 'plate_number', cp.plate_number,
      'on_duty', coalesce(cp.on_duty, false), 'on_duty_since', cp.on_duty_since, 'fee_etb', private.courier_fee(v_uid),
      'today_delivered', (select count(*) from public.courier_earnings e where e.courier_id = v_uid and e.earned_at >= date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw'),
      'today_etb', (select coalesce(sum(amount_etb), 0) from public.courier_earnings e where e.courier_id = v_uid and e.earned_at >= date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw'),
      'month_etb', (select coalesce(sum(amount_etb), 0) from public.courier_earnings e where e.courier_id = v_uid and e.earned_at >= date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw'),
      'unpaid_etb', (select coalesce(sum(amount_etb), 0) from public.courier_earnings e where e.courier_id = v_uid and e.payout_id is null),
      'total_delivered', (select count(*) from public.courier_earnings e where e.courier_id = v_uid),
      'unread', (select count(*) from public.courier_notifications n where n.courier_id = v_uid and n.read_at is null),
      'active', (select count(*) from public.orders o where o.courier_id = v_uid and o.status in ('confirmed', 'processing', 'out_for_delivery')))
    from public.profiles p left join public.courier_profiles cp on cp.profile_id = p.id
    where p.id = v_uid);
end;
$$;

create or replace function public.courier_set_duty(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  insert into public.courier_profiles (profile_id, on_duty, on_duty_since)
  values ((select auth.uid()), p_on, case when p_on then now() end)
  on conflict (profile_id) do update set on_duty = excluded.on_duty, on_duty_since = excluded.on_duty_since;
  perform private.audit(case when p_on then 'courier_on_duty' else 'courier_off_duty' end, 'profiles', (select auth.uid())::text);
end;
$$;

create or replace function public.courier_update_details(p_phone text, p_vehicle text, p_plate text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('deliveries.own');
  insert into public.courier_profiles (profile_id, phone, vehicle, plate_number)
  values ((select auth.uid()), nullif(btrim(p_phone), ''), coalesce(nullif(p_vehicle, ''), 'motorbike'), nullif(upper(btrim(p_plate)), ''))
  on conflict (profile_id) do update set phone = excluded.phone, vehicle = excluded.vehicle, plate_number = excluded.plate_number;
  perform private.audit('courier_details_updated', 'profiles', (select auth.uid())::text);
end;
$$;

create or replace function public.courier_mark_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.courier_notifications set read_at = now() where courier_id = (select auth.uid()) and read_at is null
$$;

-- ------------------------------------------------------------ admin
create or replace function public.admin_couriers()
returns table (id uuid, member_id text, full_name text, email text, is_active boolean, phone text, vehicle text, plate_number text,
               on_duty boolean, on_duty_since timestamptz, fee_etb numeric, fee_override_etb numeric, active_deliveries bigint,
               delivered_month bigint, delivered_total bigint, failed_month bigint, unpaid_etb numeric, last_delivered_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission('couriers.manage') or private.has_permission('orders.manage')) then perform private.app_error('forbidden'); end if;
  return query
    select p.id, private.member_of(p.id), p.full_name, u.email::text, p.is_active, cp.phone, coalesce(cp.vehicle, 'motorbike'), cp.plate_number,
           coalesce(cp.on_duty, false), cp.on_duty_since, private.courier_fee(p.id), cp.fee_override_etb,
           (select count(*) from public.orders o where o.courier_id = p.id and o.status in ('confirmed', 'processing', 'out_for_delivery')),
           (select count(*) from public.courier_earnings e where e.courier_id = p.id and e.earned_at >= date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw'),
           (select count(*) from public.courier_earnings e where e.courier_id = p.id),
           (select count(*) from public.audit_logs a where a.actor_id = p.id and a.action = 'delivery_failed'
              and a.created_at >= date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw'),
           case when private.has_permission('couriers.manage') then (select coalesce(sum(e.amount_etb), 0) from public.courier_earnings e where e.courier_id = p.id and e.payout_id is null) end,
           (select max(e.earned_at) from public.courier_earnings e where e.courier_id = p.id)
      from public.profiles p
      join public.admin_roles r on r.id = p.role_id and r.key = 'courier'
      join auth.users u on u.id = p.id
      left join public.courier_profiles cp on cp.profile_id = p.id
     where p.removed_at is null
     order by coalesce(cp.on_duty, false) desc, p.full_name;
end;
$$;

create or replace function public.admin_update_courier(p_courier uuid, p_phone text, p_vehicle text, p_plate text, p_fee_override numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('couriers.manage');
  if not exists (select 1 from public.profiles p join public.admin_roles r on r.id = p.role_id where p.id = p_courier and r.key = 'courier') then
    perform private.app_error('not_found');
  end if;
  insert into public.courier_profiles (profile_id, phone, vehicle, plate_number, fee_override_etb)
  values (p_courier, nullif(btrim(p_phone), ''), coalesce(nullif(p_vehicle, ''), 'motorbike'), nullif(upper(btrim(p_plate)), ''), p_fee_override)
  on conflict (profile_id) do update set phone = excluded.phone, vehicle = excluded.vehicle, plate_number = excluded.plate_number,
                                         fee_override_etb = excluded.fee_override_etb;
  perform private.audit('courier_details_updated', 'profiles', p_courier::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('fee_override_etb', p_fee_override)));
end;
$$;

create or replace function public.admin_set_courier_fee(p_fee numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('couriers.manage');
  if p_fee is null or p_fee < 0 or p_fee > 100000 then perform private.app_error('invalid_amount'); end if;
  insert into public.website_settings (key, value, is_public) values ('courier', jsonb_build_object('fee_per_delivery_etb', p_fee), false)
  on conflict (key) do update set value = public.website_settings.value || jsonb_build_object('fee_per_delivery_etb', p_fee);
  perform private.audit('courier_fee_set', 'website_settings', 'courier', null, null, jsonb_build_object('fee_per_delivery_etb', p_fee));
end;
$$;

-- Pay all unpaid earnings of a courier (cash / transfer done outside the website) → one payout record.
create or replace function public.admin_pay_courier(p_courier uuid, p_reference text default null, p_note text default null)
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
  perform private.require_permission('couriers.manage');
  if not private.mfa_verified() then perform private.app_error('forbidden'); end if;
  perform 1 from public.courier_earnings where courier_id = p_courier and payout_id is null for update;
  select coalesce(sum(amount_etb), 0), count(*) into v_sum, v_n from public.courier_earnings where courier_id = p_courier and payout_id is null;
  if v_n = 0 or v_sum <= 0 then perform private.app_error('invalid_amount'); end if;
  insert into public.courier_payouts (courier_id, amount_etb, deliveries, reference, note)
  values (p_courier, v_sum, v_n, nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  update public.courier_earnings set payout_id = v_id where courier_id = p_courier and payout_id is null;
  perform private.notify_courier(p_courier, 'payout', 'Payment recorded: ' || v_sum || ' ETB',
    v_n || ' deliveries' || coalesce(' · ref ' || nullif(btrim(coalesce(p_reference, '')), ''), ''), null);
  perform private.audit('courier_paid', 'profiles', p_courier::text, null, null,
    jsonb_build_object('amount_etb', v_sum, 'deliveries', v_n, 'reference', p_reference, 'courier_user_id', private.member_of(p_courier)));
  return jsonb_build_object('payout_id', v_id, 'amount_etb', v_sum, 'deliveries', v_n);
end;
$$;

-- Paid delivery orders still needing a courier (new, or back after "couldn't deliver").
create or replace function public.admin_dispatch_orders()
returns table (order_id uuid, order_number text, status text, city text, address_line text, total_etb numeric, paid_at timestamptz,
               courier_id uuid, delivery_attempts integer, fail_reason text, items integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('orders.manage');
  return query
    select o.id, o.order_number::text, o.status::text, o.city, o.address_line, o.total_etb, o.payment_verified_at, o.courier_id,
           o.delivery_attempts, o.delivery_fail_reason, (select coalesce(sum(i.quantity), 0)::int from public.order_items i where i.order_id = o.id)
      from public.orders o
     where o.fulfillment_method = 'delivery' and o.status in ('confirmed', 'processing')
       and o.payment_status = 'verified'
       and (o.courier_id is null or o.delivery_failed_at is not null)
     order by o.payment_verified_at nulls last
     limit 200;
end;
$$;

-- Reset test data (Admin → Export everything / reset) also clears courier earnings, payouts and notifications.
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

revoke all on function private.courier_fee(uuid) from public;
revoke all on function private.notify_courier(uuid, text, text, text, uuid) from public;
revoke all on function public.courier_me() from public, anon;
revoke all on function public.courier_set_duty(boolean) from public, anon;
revoke all on function public.courier_update_details(text, text, text) from public, anon;
revoke all on function public.courier_mark_notifications_read() from public, anon;
revoke all on function public.admin_couriers() from public, anon;
revoke all on function public.admin_update_courier(uuid, text, text, text, numeric) from public, anon;
revoke all on function public.admin_set_courier_fee(numeric) from public, anon;
revoke all on function public.admin_pay_courier(uuid, text, text) from public, anon;
revoke all on function public.admin_dispatch_orders() from public, anon;
grant execute on function public.courier_me() to authenticated;
grant execute on function public.courier_set_duty(boolean) to authenticated;
grant execute on function public.courier_update_details(text, text, text) to authenticated;
grant execute on function public.courier_mark_notifications_read() to authenticated;
grant execute on function public.admin_couriers() to authenticated;
grant execute on function public.admin_update_courier(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.admin_set_courier_fee(numeric) to authenticated;
grant execute on function public.admin_pay_courier(uuid, text, text) to authenticated;
grant execute on function public.admin_dispatch_orders() to authenticated;
