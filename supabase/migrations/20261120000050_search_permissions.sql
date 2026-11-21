-- =============================================================================
-- 0050 SEARCH BY DATE, PERMISSION SETS, PERSONAL PERMISSIONS
--   * Security events, activity log and notifications can be searched by
--     text and a date range.
--   * Super Admin manages permission sets (roles): edit what Manager / Staff
--     can do, create new sets, assign them. Super Admin keeps everything.
--   * Extra permissions for one staff member or manager on top of their set.
--   * "Manage staff" (staff.manage) stays Super Admin only.
-- =============================================================================

-- ---------------------------------------------------------------- Search with dates
drop function if exists public.admin_security_events(text, text, integer);
create or replace function public.admin_security_events(
  p_kind text default null, p_email text default null, p_limit integer default 100,
  p_from timestamptz default null, p_to timestamptz default null, p_search text default null)
returns table (id bigint, kind text, email text, user_name text, ip_hash text, user_agent text, metadata jsonb, created_at timestamptz)
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
    select s.id, s.kind, s.email, private.actor_name(s.user_id), left(s.ip_hash, 8), s.user_agent, s.metadata, s.created_at
      from public.security_events s
     where (p_kind is null or s.kind = p_kind) and (p_email is null or s.email = lower(btrim(p_email)))
       and (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to)
       and (v_q is null or s.email ilike '%' || v_q || '%' or s.kind ilike '%' || v_q || '%' or s.user_agent ilike '%' || v_q || '%'
            or s.ip_hash ilike v_q || '%')
     order by s.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 1000));
end;
$$;
revoke all on function public.admin_security_events(text, text, integer, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_security_events(text, text, integer, timestamptz, timestamptz, text) to authenticated;

drop function if exists public.admin_activity_by_category(text, text, integer, bigint);
create or replace function public.admin_activity_by_category(
  p_category text default null, p_search text default null, p_limit integer default 100, p_before_id bigint default null,
  p_from timestamptz default null, p_to timestamptz default null)
returns table (
  id bigint, created_at timestamptz, actor_id uuid, actor_name text, actor_role text,
  action text, entity_type text, entity_id text, entity_label text,
  before_data jsonb, after_data jsonb, metadata jsonb, category text
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
  if p_category is not null and p_category not in ('orders', 'payments', 'customers', 'catalog', 'staff', 'security', 'other') then
    perform private.app_error('invalid_request', 'category');
  end if;
  return query
    select a.id, a.created_at, a.actor_id, private.actor_name(a.actor_id), a.actor_role,
           a.action, a.entity_type, a.entity_id,
           case a.entity_type
             when 'order' then (select o.order_number from public.orders o where o.id::text = a.entity_id)
             when 'printing_job' then (select j.job_number from public.printing_jobs j where j.id::text = a.entity_id)
             when 'payment_submission' then (select o.order_number from public.payment_submissions s join public.orders o on o.id = s.order_id where s.id::text = a.entity_id)
             when 'customer_account' then coalesce(
               (select u.email::text from auth.users u where u.id::text = a.entity_id), a.before_data ->> 'email')
             when 'profiles' then private.actor_name(case when a.entity_id ~ '^[0-9a-f-]{36}$' then a.entity_id::uuid end)
             when 'products' then coalesce(a.after_data ->> 'name_en', a.before_data ->> 'name_en')
             else null
           end,
           a.before_data, a.after_data, a.metadata, private.activity_category(a.action, a.entity_type)
      from public.audit_logs a
     where (p_category is null or private.activity_category(a.action, a.entity_type) = p_category)
       and (p_before_id is null or a.id < p_before_id)
       and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to)
       and (v_q is null or a.action ilike '%' || v_q || '%' or a.entity_id ilike '%' || v_q || '%'
            or private.actor_name(a.actor_id) ilike '%' || v_q || '%')
     order by a.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.admin_activity_by_category(text, text, integer, bigint, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_activity_by_category(text, text, integer, bigint, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_notifications_search(p_from timestamptz default null, p_to timestamptz default null, p_search text default null, p_limit integer default 600)
returns table (
  id bigint, channel text, event_type text, status public.notification_status, attempts integer, max_attempts integer,
  last_error text, created_at timestamptz, sent_at timestamptz, next_attempt_at timestamptz, reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('settings.manage');
  return query
    select o.id, o.channel, o.event_type, o.status, o.attempts, o.max_attempts, o.last_error, o.created_at, o.sent_at, o.next_attempt_at,
           coalesce(o.payload ->> 'order_number', o.payload ->> 'job_number', o.payload ->> 'number', o.payload ->> 'topup_number',
                    o.payload ->> 'email', o.payload ->> 'name', o.payload ->> 'label')
      from public.notifications_outbox o
     where (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at < p_to)
       and (v_q is null or o.event_type ilike '%' || v_q || '%' or o.channel ilike '%' || v_q || '%' or o.last_error ilike '%' || v_q || '%'
            or o.payload::text ilike '%' || v_q || '%'
            or exists (select 1 from auth.users u where u.id = o.recipient_user_id and u.email ilike '%' || v_q || '%'))
     order by o.id desc
     limit greatest(1, least(coalesce(p_limit, 600), 2000));
end;
$$;
revoke all on function public.admin_notifications_search(timestamptz, timestamptz, text, integer) from public, anon;
grant execute on function public.admin_notifications_search(timestamptz, timestamptz, text, integer) to authenticated;

-- ---------------------------------------------------------------- Personal permissions
create table public.profile_permissions (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.admin_permissions(key) on delete cascade,
  granted_by     uuid references auth.users(id) on delete set null default auth.uid(),
  granted_at     timestamptz not null default now(),
  primary key (profile_id, permission_key)
);
alter table public.profile_permissions enable row level security;
revoke all on public.profile_permissions from anon, authenticated;
grant select on public.profile_permissions to authenticated;
create policy profile_permissions_read on public.profile_permissions for select to authenticated using ((select private.is_admin()));
create trigger audit_profile_permissions after insert or delete on public.profile_permissions
  for each row execute function private.audit_row_change();

-- Permission = from the person's set OR given to them personally.
create or replace function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.mfa_verified() and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
      and (exists (select 1 from public.role_permissions rp where rp.role_id = p.role_id and rp.permission_key = p_permission)
        or exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_key = p_permission))
  )
$$;

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
    'role_name', r.name,
    'permissions', coalesce((
      select jsonb_agg(k order by k) from (
        select rp.permission_key as k from public.role_permissions rp where rp.role_id = p.role_id
        union
        select pp.permission_key from public.profile_permissions pp where pp.profile_id = p.id) x
    ), '[]'::jsonb)
  ) end
  from (select 1) d
  left join public.profiles p on p.id = (select auth.uid()) and p.is_active and private.mfa_verified()
  left join public.admin_roles r on r.id = p.role_id
$$;

-- ---------------------------------------------------------------- Permission sets (roles)
alter table public.admin_roles add column is_builtin boolean not null default false;
update public.admin_roles set is_builtin = true where key in ('super_admin', 'manager', 'staff');

-- Checks a list of permission keys (staff.manage stays with Super Admin).
create or replace function private.check_permission_list(p_permissions text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := coalesce((select array_agg(distinct btrim(x)) from unnest(coalesce(p_permissions, '{}')) x where btrim(x) <> ''), '{}');
begin
  if exists (select 1 from unnest(v) x where x not in (select key from public.admin_permissions)) then
    perform private.app_error('invalid_request', 'unknown permission');
  end if;
  if 'staff.manage' = any(v) then perform private.app_error('invalid_request', 'staff.manage is Super Admin only'); end if;
  return v;
end;
$$;

create or replace function public.admin_save_role(p_role_id smallint, p_name text, p_description text, p_permissions text[])
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id smallint := p_role_id;
  v_key text;
  v_perms text[];
  v_role public.admin_roles;
begin
  perform private.require_permission('staff.manage');
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 60 then perform private.app_error('invalid_name'); end if;
  if p_description is not null and char_length(p_description) > 300 then perform private.app_error('invalid_request', 'description'); end if;
  v_perms := private.check_permission_list(p_permissions);
  perform pg_advisory_xact_lock(hashtext('staff_roles'));
  if v_id is null then
    v_key := left(trim(both '_' from regexp_replace(lower(btrim(p_name)), '[^a-z]+', '_', 'g')), 30);
    if char_length(v_key) < 2 then v_key := 'role'; end if;
    while exists (select 1 from public.admin_roles where key = v_key) loop
      v_key := left(v_key, 26) || '_' || floor(random() * 900 + 100)::int;
    end loop;
    insert into public.admin_roles (key, name, description) values (v_key, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''))
    returning id into v_id;
  else
    select * into v_role from public.admin_roles where id = v_id;
    if not found then perform private.app_error('not_found'); end if;
    if v_role.key = 'super_admin' then perform private.app_error('invalid_request', 'Super Admin always has every permission'); end if;
    update public.admin_roles set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), '') where id = v_id;
  end if;
  delete from public.role_permissions where role_id = v_id and permission_key <> all(v_perms);
  insert into public.role_permissions (role_id, permission_key) select v_id, x from unnest(v_perms) x on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function public.admin_save_role(smallint, text, text, text[]) from public, anon;
grant execute on function public.admin_save_role(smallint, text, text, text[]) to authenticated;

create or replace function public.admin_delete_role(p_role_id smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.admin_roles;
begin
  perform private.require_permission('staff.manage');
  select * into v from public.admin_roles where id = p_role_id;
  if not found then perform private.app_error('not_found'); end if;
  if v.is_builtin then perform private.app_error('invalid_request', 'built-in set'); end if;
  if exists (select 1 from public.profiles where role_id = p_role_id) then perform private.app_error('invalid_request', 'set still assigned'); end if;
  delete from public.admin_roles where id = p_role_id;
end;
$$;
revoke all on function public.admin_delete_role(smallint) from public, anon;
grant execute on function public.admin_delete_role(smallint) to authenticated;

-- Extra permissions for one person (not yourself; not a Super Admin, who has everything).
create or replace function public.admin_set_member_permissions(p_user_id uuid, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perms text[];
begin
  perform private.require_permission('staff.manage');
  if p_user_id = (select auth.uid()) then perform private.app_error('cannot_modify_self'); end if;
  if not exists (select 1 from public.profiles where id = p_user_id and removed_at is null) then perform private.app_error('not_found'); end if;
  v_perms := private.check_permission_list(p_permissions);
  delete from public.profile_permissions where profile_id = p_user_id and permission_key <> all(v_perms);
  insert into public.profile_permissions (profile_id, permission_key) select p_user_id, x from unnest(v_perms) x on conflict do nothing;
end;
$$;
revoke all on function public.admin_set_member_permissions(uuid, text[]) from public, anon;
grant execute on function public.admin_set_member_permissions(uuid, text[]) to authenticated;
