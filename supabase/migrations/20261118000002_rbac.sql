-- =============================================================================
-- 0002 ADMIN USERS, ROLES, PERMISSIONS
-- Customers do NOT have accounts (guest checkout). Only staff live in profiles.
-- =============================================================================

create table public.admin_roles (
  id          smallint generated always as identity primary key,
  key         text not null unique check (key ~ '^[a-z_]{2,40}$'),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table public.admin_permissions (
  key         text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

create table public.role_permissions (
  role_id        smallint not null references public.admin_roles(id) on delete cascade,
  permission_key text not null references public.admin_permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 1 and 120),
  phone       text,
  role_id     smallint not null references public.admin_roles(id) on delete restrict,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);
create index profiles_role_idx on public.profiles(role_id);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed roles & permissions (configuration, not sample data)
-- ---------------------------------------------------------------------------
insert into public.admin_roles (key, name, description) values
  ('super_admin', 'Super Admin', 'Full access including bank accounts, staff and settings'),
  ('manager',     'Manager',     'Products, inventory, orders, payments and operational reports'),
  ('staff',       'Staff',       'Assigned orders, fulfillment updates and printing jobs');

insert into public.admin_permissions (key, description) values
  ('dashboard.view',            'View the admin dashboard'),
  ('products.view',             'View all products including drafts and archived'),
  ('products.manage',           'Create, edit, archive products and images'),
  ('categories.manage',         'Create and edit categories'),
  ('inventory.manage',          'Adjust stock and view inventory history'),
  ('orders.view_all',           'View every order'),
  ('orders.view_assigned',      'View orders assigned to me'),
  ('orders.manage',             'Change any order status, cancel, assign'),
  ('orders.update_fulfillment', 'Move orders through fulfillment statuses'),
  ('payments.view',             'View payment submissions and receipts'),
  ('payments.verify',           'Verify or reject payments'),
  ('printing.view',             'View printing jobs and download documents'),
  ('printing.manage',           'Update printing job status and quotes'),
  ('printing.pricing',          'Change printing price rules'),
  ('customers.view',            'View customer directory'),
  ('reports.operational',       'View operational reports (orders, stock)'),
  ('analytics.view',            'View financial analytics and revenue'),
  ('promotions.manage',         'Manage promotions and homepage banners'),
  ('staff.manage',              'Invite staff and change roles'),
  ('settings.manage',           'Change website, delivery and business settings'),
  ('bank_accounts.manage',      'Change bank accounts shown to customers'),
  ('audit.view',                'Read the audit log');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r cross join public.admin_permissions p
where r.key = 'super_admin';

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r join public.admin_permissions p on p.key in (
  'dashboard.view', 'products.view', 'products.manage', 'categories.manage',
  'inventory.manage', 'orders.view_all', 'orders.manage', 'orders.update_fulfillment',
  'payments.view', 'payments.verify', 'printing.view', 'printing.manage',
  'printing.pricing', 'customers.view', 'reports.operational', 'promotions.manage'
) where r.key = 'manager';

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r join public.admin_permissions p on p.key in (
  'dashboard.view', 'orders.view_assigned', 'orders.update_fulfillment',
  'printing.view', 'printing.manage'
) where r.key = 'staff';

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so RLS policies can call them
-- without recursion; they only ever answer about the *calling* user).
-- ---------------------------------------------------------------------------
create or replace function private.current_role_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.key
  from public.profiles p
  join public.admin_roles r on r.id = p.role_id
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
$$;

create or replace function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = (select auth.uid())
      and p.is_active
      and rp.permission_key = p_permission
  )
$$;

create or replace function private.require_permission(p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_permission) then
    perform private.app_error('forbidden', p_permission);
  end if;
end;
$$;

grant execute on function private.current_role_key() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.has_permission(text) to authenticated, service_role;
grant execute on function private.require_permission(text) to authenticated, service_role;

-- Public RPC so the app can render the right navigation for the signed-in admin.
create or replace function public.my_admin_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.id is null then null else jsonb_build_object(
    'user_id', p.id,
    'full_name', p.full_name,
    'role', r.key,
    'permissions', coalesce((
      select jsonb_agg(rp.permission_key order by rp.permission_key)
      from public.role_permissions rp where rp.role_id = p.role_id
    ), '[]'::jsonb)
  ) end
  from (select 1) d
  left join public.profiles p on p.id = (select auth.uid()) and p.is_active
  left join public.admin_roles r on r.id = p.role_id
$$;
revoke execute on function public.my_admin_context() from public, anon;
grant execute on function public.my_admin_context() to authenticated;

-- ---------------------------------------------------------------------------
-- Initial super-admin bootstrap. Only works while NO active super admin
-- exists, and only from trusted server contexts (service_role / SQL editor).
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_super_admin(p_user_id uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role smallint;
begin
  perform pg_advisory_xact_lock(hashtext('bootstrap_super_admin'));
  select id into v_role from public.admin_roles where key = 'super_admin';
  if exists (select 1 from public.profiles where role_id = v_role and is_active) then
    perform private.app_error('super_admin_exists');
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    perform private.app_error('user_not_found');
  end if;
  insert into public.profiles (id, full_name, role_id)
  values (p_user_id, p_full_name, v_role)
  on conflict (id) do update set role_id = excluded.role_id, is_active = true,
    full_name = excluded.full_name;
end;
$$;
revoke execute on function public.bootstrap_super_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid, text) to service_role;
