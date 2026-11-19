-- =============================================================================
-- 0018 CUSTOMER ACCOUNT MANAGEMENT
--   * customers.manage permission (Super Admin by default): reset password,
--     invite, deactivate / reactivate and delete customer accounts.
--     Staff accounts are never managed here (they live under Staff).
--   * Deactivation: recorded on customer_accounts and enforced in the database
--     (no new orders / printing jobs, no reading own data). The app also bans
--     the user in Supabase Auth so they cannot sign in.
--   * Customer activity timeline (admin actions, own profile changes, sign-in
--     events, orders, payments, printing jobs) and a global activity log.
--   * Saved baskets of signed-in customers + "stalled checkouts" (> N hours).
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('customers.manage', 'Reset passwords, invite, deactivate and delete customer accounts')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select id, 'customers.manage' from public.admin_roles where key = 'super_admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Deactivation
-- ---------------------------------------------------------------------------
alter table public.customer_accounts
  add column deactivated_at      timestamptz,
  add column deactivated_by      uuid references auth.users(id) on delete set null,
  add column deactivation_reason text check (char_length(deactivation_reason) <= 500);

-- Is this user allowed to use their customer account? (not deactivated, not banned)
create or replace function private.is_active_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and not exists (select 1 from public.customer_accounts c where c.id = p_user_id and c.deactivated_at is not null)
    and not exists (select 1 from auth.users u where u.id = p_user_id and u.banned_until is not null and u.banned_until > now())
$$;
create or replace function private.is_active_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user((select auth.uid()))
$$;
grant execute on function private.is_active_customer() to authenticated;

create or replace function private.assert_confirmed_user(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
  ) then
    perform private.app_error('login_required');
  end if;
  if not private.is_active_user(p_user_id) then
    perform private.app_error('account_deactivated');
  end if;
end;
$$;

-- Deactivated customers lose access to their own data (staff policies unchanged).
create or replace function private.owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.orders o where o.id = p_order_id and o.user_id = (select auth.uid()))
     and private.is_active_customer()
$$;

drop policy orders_customer_read on public.orders;
create policy orders_customer_read on public.orders for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_customer()));
drop policy printing_jobs_customer_read on public.printing_jobs;
create policy printing_jobs_customer_read on public.printing_jobs for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_customer()));
drop policy customer_accounts_own_update on public.customer_accounts;
create policy customer_accounts_own_update on public.customer_accounts for update to authenticated
  using (id = (select auth.uid()) and (select private.is_active_customer()))
  with check (id = (select auth.uid()));

-- Customers' own name/phone changes go to the audit log (shown on their timeline).
create or replace function private.audit_customer_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.full_name, old.phone) is distinct from (new.full_name, new.phone) then
    perform private.audit('profile_updated', 'customer_account', new.id::text,
      jsonb_build_object('full_name', old.full_name, 'phone', old.phone),
      jsonb_build_object('full_name', new.full_name, 'phone', new.phone));
  end if;
  return new;
end;
$$;
create trigger audit_customer_accounts after update of full_name, phone on public.customer_accounts
  for each row execute function private.audit_customer_account_change();

-- Target must be an existing, non-staff account.
create or replace function private.assert_manageable_customer(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    perform private.app_error('user_not_found');
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    perform private.app_error('cannot_manage_staff');
  end if;
end;
$$;

create or replace function public.admin_set_customer_active(p_user_id uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before public.customer_accounts;
begin
  perform private.require_permission('customers.manage');
  perform private.assert_manageable_customer(p_user_id);
  if p_active is null then perform private.app_error('invalid_request'); end if;
  if not p_active and (v_reason is null or char_length(v_reason) > 500) then
    perform private.app_error('invalid_reason');
  end if;

  insert into public.customer_accounts (id) values (p_user_id) on conflict do nothing;
  select * into v_before from public.customer_accounts where id = p_user_id for update;
  if p_active = (v_before.deactivated_at is null) then
    return; -- already in that state
  end if;

  update public.customer_accounts
     set deactivated_at      = case when p_active then null else now() end,
         deactivated_by      = case when p_active then null else (select auth.uid()) end,
         deactivation_reason = case when p_active then null else v_reason end
   where id = p_user_id;

  perform private.audit(
    case when p_active then 'customer_reactivated' else 'customer_deactivated' end,
    'customer_account', p_user_id::text,
    jsonb_build_object('deactivated_at', v_before.deactivated_at, 'reason', v_before.deactivation_reason),
    null,
    jsonb_build_object('reason', v_reason));
end;
$$;

-- Records account actions performed through Supabase Auth by the app
-- (password reset email, invite, deletion) in the audit log.
create or replace function public.admin_log_customer_action(p_user_id uuid, p_action text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('customers.manage');
  if p_action not in ('password_reset_sent', 'invite_sent', 'customer_deleted') then
    perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 4000 then
    perform private.app_error('invalid_request');
  end if;
  if p_action = 'customer_deleted' then
    -- Logged after the auth user is gone.
    if p_user_id is null or exists (select 1 from auth.users where id = p_user_id) then
      perform private.app_error('invalid_request');
    end if;
  else
    perform private.assert_manageable_customer(p_user_id);
  end if;
  perform private.audit(p_action, 'customer_account', p_user_id::text,
    case when p_action = 'customer_deleted' then p_metadata end, null,
    case when p_action = 'customer_deleted' then '{}'::jsonb else p_metadata end);
end;
$$;

-- Checks a delete is allowed and returns a snapshot to keep in the audit log.
-- Accounts with orders or printing jobs are kept (history) — deactivate instead.
create or replace function public.admin_prepare_customer_delete(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.require_permission('customers.manage');
  perform private.assert_manageable_customer(p_user_id);
  if exists (select 1 from public.orders where user_id = p_user_id)
     or exists (select 1 from public.printing_jobs where user_id = p_user_id) then
    perform private.app_error('has_orders');
  end if;
  select jsonb_build_object('email', u.email, 'full_name', c.full_name, 'phone', c.phone,
                            'created_at', u.created_at, 'email_confirmed_at', u.email_confirmed_at)
    into v
    from auth.users u left join public.customer_accounts c on c.id = u.id
   where u.id = p_user_id;
  return v;
end;
$$;

-- Account list: now also returns the deactivation state.
drop function public.admin_customer_accounts(text, integer, uuid);
create function public.admin_customer_accounts(p_search text default null, p_limit integer default 100, p_user_id uuid default null)
returns table (
  id uuid, email text, full_name text, phone text, created_at timestamptz,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz, is_staff boolean,
  order_count bigint, last_order_at timestamptz,
  deactivated_at timestamptz, deactivation_reason text, deactivated_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('customers.view');
  return query
    select u.id, u.email::text, c.full_name, c.phone, u.created_at, u.email_confirmed_at, u.last_sign_in_at,
           exists (select 1 from public.profiles p where p.id = u.id) as is_staff,
           (select count(*) from public.orders o where o.user_id = u.id) as order_count,
           (select max(o.created_at) from public.orders o where o.user_id = u.id) as last_order_at,
           c.deactivated_at, c.deactivation_reason,
           (select p.full_name from public.profiles p where p.id = c.deactivated_by)
    from auth.users u
    left join public.customer_accounts c on c.id = u.id
    where (p_user_id is null or u.id = p_user_id)
      and (v_q is null
       or u.email ilike '%' || v_q || '%'
       or c.full_name ilike '%' || v_q || '%'
       or c.phone ilike '%' || v_q || '%')
    order by u.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- Activity
-- ---------------------------------------------------------------------------
create or replace function private.actor_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.full_name from public.profiles p where p.id = p_user_id),
    (select c.full_name from public.customer_accounts c where c.id = p_user_id),
    (select u.email::text from auth.users u where u.id = p_user_id))
$$;

-- One customer's history, newest first.
--   kind: admin | account | auth | order | payment | printing
create or replace function public.admin_customer_activity(p_user_id uuid, p_limit integer default 200)
returns table (at timestamptz, kind text, action text, actor_name text, reference text, details jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id text := p_user_id::text;
begin
  perform private.require_permission('customers.view');
  return query
  select * from (
    -- Admin actions and the customer's own profile changes
    select a.created_at, case when a.actor_id = p_user_id then 'account' else 'admin' end, a.action,
           private.actor_name(a.actor_id), null::text,
           jsonb_strip_nulls(jsonb_build_object('before', a.before_data, 'after', a.after_data,
             'metadata', nullif(a.metadata, '{}'::jsonb), 'actor_role', a.actor_role))
      from public.audit_logs a
     where a.entity_type = 'customer_account' and a.entity_id = v_id
    union all
    -- Supabase Auth events (sign-up, sign-in, password changes ...)
    select e.created_at, 'auth', e.payload ->> 'action',
           case when e.payload ->> 'actor_id' = v_id then null else nullif(e.payload ->> 'actor_username', '') end,
           null, jsonb_strip_nulls(jsonb_build_object('ip', nullif(e.ip_address, '')))
      from auth.audit_log_entries e
     where (e.payload ->> 'actor_id' = v_id or e.payload -> 'traits' ->> 'user_id' = v_id)
       and coalesce(e.payload ->> 'action', '') not in ('token_refreshed', 'token_revoked')
    union all
    select o.created_at, 'order', 'order_placed', null, o.order_number,
           jsonb_build_object('order_id', o.id, 'total_etb', o.total_etb, 'status', o.status)
      from public.orders o where o.user_id = p_user_id
    union all
    select h.created_at, 'order', 'order_status', private.actor_name(h.changed_by), o.order_number,
           jsonb_strip_nulls(jsonb_build_object('order_id', o.id, 'from', h.from_status, 'to', h.to_status, 'note', h.note))
      from public.order_status_history h join public.orders o on o.id = h.order_id
     where o.user_id = p_user_id and h.from_status is not null
    union all
    select s.submitted_at, 'payment', 'payment_submitted', null, o.order_number,
           jsonb_build_object('order_id', o.id, 'amount_etb', s.amount_expected_etb)
      from public.payment_submissions s join public.orders o on o.id = s.order_id
     where o.user_id = p_user_id
    union all
    select s.reviewed_at, 'payment', 'payment_' || s.status::text, private.actor_name(s.reviewed_by), o.order_number,
           jsonb_strip_nulls(jsonb_build_object('order_id', o.id, 'note', s.review_note))
      from public.payment_submissions s join public.orders o on o.id = s.order_id
     where o.user_id = p_user_id and s.reviewed_at is not null
    union all
    select j.created_at, 'printing', 'printing_submitted', null, j.job_number,
           jsonb_strip_nulls(jsonb_build_object('job_id', j.id, 'status', j.status, 'total_etb', j.total_etb))
      from public.printing_jobs j where j.user_id = p_user_id
  ) t (at, kind, action, actor_name, reference, details)
  order by t.at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

-- Every critical change across the system (audit log) with actor names.
create or replace function public.admin_activity_log(
  p_entity_type text default null, p_search text default null,
  p_limit integer default 100, p_before_id bigint default null)
returns table (
  id bigint, created_at timestamptz, actor_id uuid, actor_name text, actor_role text,
  action text, entity_type text, entity_id text, entity_label text,
  before_data jsonb, after_data jsonb, metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('audit.view');
  return query
    select a.id, a.created_at, a.actor_id, private.actor_name(a.actor_id), a.actor_role,
           a.action, a.entity_type, a.entity_id,
           case a.entity_type
             when 'order' then (select o.order_number from public.orders o where o.id::text = a.entity_id)
             when 'printing_job' then (select j.job_number from public.printing_jobs j where j.id::text = a.entity_id)
             when 'customer_account' then coalesce(
               (select u.email::text from auth.users u where u.id::text = a.entity_id), a.before_data ->> 'email')
             when 'profiles' then private.actor_name(case when a.entity_id ~ '^[0-9a-f-]{36}$' then a.entity_id::uuid end)
             when 'products' then coalesce(a.after_data ->> 'name_en', a.before_data ->> 'name_en')
             else null
           end,
           a.before_data, a.after_data, a.metadata
      from public.audit_logs a
     where (p_entity_type is null or a.entity_type = p_entity_type)
       and (p_before_id is null or a.id < p_before_id)
       and (v_q is null or a.action ilike '%' || v_q || '%' or a.entity_id ilike '%' || v_q || '%'
            or private.actor_name(a.actor_id) ilike '%' || v_q || '%')
     order by a.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- Saved baskets (signed-in customers) and stalled checkouts
-- ---------------------------------------------------------------------------
create or replace function private.valid_cart_items(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 50
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e ->> 'product_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or jsonb_typeof(e -> 'quantity') <> 'number'
           or (e ->> 'quantity') !~ '^[0-9]{1,3}$'
           or (e ->> 'quantity')::int not between 1 and 999)
$$;

grant execute on function private.valid_cart_items(jsonb) to authenticated, service_role;

create table public.customer_carts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  items      jsonb not null default '[]'::jsonb check (private.valid_cart_items(items)),
  item_count integer not null default 0,
  updated_at timestamptz not null default now()
);
create index customer_carts_stalled_idx on public.customer_carts(updated_at) where item_count > 0;

create or replace function private.customer_carts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.item_count := coalesce((select sum((e ->> 'quantity')::int) from jsonb_array_elements(new.items) e), 0);
  new.updated_at := now();
  return new;
end;
$$;
create trigger customer_carts_touch before insert or update on public.customer_carts
  for each row execute function private.customer_carts_touch();

alter table public.customer_carts enable row level security;
revoke all on public.customer_carts from anon, authenticated;
grant select, delete on public.customer_carts to authenticated;
-- update(user_id) is needed by upsert; the policies pin user_id to the caller.
grant insert (user_id, items), update (user_id, items) on public.customer_carts to authenticated;
create policy customer_carts_own_read on public.customer_carts for select to authenticated
  using (user_id = (select auth.uid()));
create policy customer_carts_own_insert on public.customer_carts for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_customer()));
create policy customer_carts_own_update on public.customer_carts for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_customer()))
  with check (user_id = (select auth.uid()));
create policy customer_carts_own_delete on public.customer_carts for delete to authenticated
  using (user_id = (select auth.uid()));

-- A successful order empties the saved basket.
create or replace function public.create_order_for_user(p_user_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_result jsonb;
begin
  perform private.assert_confirmed_user(p_user_id);
  -- An idempotent replay must come from the same account.
  select user_id into v_owner from public.orders where idempotency_key = (p_input ->> 'idempotency_key')::uuid;
  if found and v_owner is distinct from p_user_id then
    perform private.app_error('idempotency_conflict');
  end if;
  perform set_config('app.ordering_user_id', p_user_id::text, true);
  v_result := public.create_order(p_input);
  -- Clear immediately so nothing later in the same transaction inherits this user.
  perform set_config('app.ordering_user_id', '', true);
  delete from public.customer_carts where user_id = p_user_id;
  return v_result;
end;
$$;

-- Customers who started but did not finish (older than p_hours):
--   unpaid_order    order placed, no payment submitted (or payment rejected)
--   unpaid_printing printing job priced, not paid
--   basket          items saved in the basket, no order placed
create or replace function public.admin_stalled_checkouts(p_hours integer default 2)
returns table (
  kind text, since timestamptz, user_id uuid, email text, full_name text, phone text,
  reference text, entity_id uuid, amount_etb numeric, item_count integer, status text, items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 2), 720)));
begin
  perform private.require_permission('customers.view');
  return query
  select * from (
    select 'unpaid_order'::text, o.updated_at, o.user_id, u.email::text, coalesce(c.full_name, o.customer_name),
           coalesce(c.phone, o.customer_phone), o.order_number, o.id, o.total_etb,
           (select coalesce(sum(i.quantity), 0)::int from public.order_items i where i.order_id = o.id),
           o.status::text, null::jsonb
      from public.orders o
      left join auth.users u on u.id = o.user_id
      left join public.customer_accounts c on c.id = o.user_id
     where o.status in ('awaiting_payment', 'payment_rejected') and o.updated_at < v_cutoff
    union all
    select 'unpaid_printing', j.updated_at, j.user_id, u.email::text, coalesce(c.full_name, j.customer_name),
           coalesce(c.phone, j.customer_phone), j.job_number, j.id, j.total_etb, j.copies,
           j.status::text, null::jsonb
      from public.printing_jobs j
      left join auth.users u on u.id = j.user_id
      left join public.customer_accounts c on c.id = j.user_id
     where j.status = 'awaiting_payment' and j.order_id is null and j.updated_at < v_cutoff
    union all
    select 'basket', k.updated_at, k.user_id, u.email::text, c.full_name, c.phone, null, null,
           (select sum(coalesce(p.sale_price_etb, p.price_etb) * (e ->> 'quantity')::int)
              from jsonb_array_elements(k.items) e join public.products p on p.id = (e ->> 'product_id')::uuid),
           k.item_count, null,
           (select jsonb_agg(jsonb_build_object('name', coalesce(p.name_en, '?'), 'quantity', (e ->> 'quantity')::int))
              from jsonb_array_elements(k.items) e left join public.products p on p.id = (e ->> 'product_id')::uuid)
      from public.customer_carts k
      join auth.users u on u.id = k.user_id
      left join public.customer_accounts c on c.id = k.user_id
     where k.item_count > 0 and k.updated_at < v_cutoff and k.updated_at > now() - interval '30 days'
       and private.is_active_user(k.user_id)
  ) t
  order by 2 desc
  limit 500;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_set_customer_active(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_log_customer_action(uuid, text, jsonb) from public, anon;
revoke execute on function public.admin_prepare_customer_delete(uuid) from public, anon;
revoke execute on function public.admin_customer_accounts(text, integer, uuid) from public, anon;
revoke execute on function public.admin_customer_activity(uuid, integer) from public, anon;
revoke execute on function public.admin_activity_log(text, text, integer, bigint) from public, anon;
revoke execute on function public.admin_stalled_checkouts(integer) from public, anon;
grant execute on function public.admin_set_customer_active(uuid, boolean, text) to authenticated;
grant execute on function public.admin_log_customer_action(uuid, text, jsonb) to authenticated;
grant execute on function public.admin_prepare_customer_delete(uuid) to authenticated;
grant execute on function public.admin_customer_accounts(text, integer, uuid) to authenticated;
grant execute on function public.admin_customer_activity(uuid, integer) to authenticated;
grant execute on function public.admin_activity_log(text, text, integer, bigint) to authenticated;
grant execute on function public.admin_stalled_checkouts(integer) to authenticated;
