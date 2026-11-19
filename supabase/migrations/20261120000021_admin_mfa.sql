-- =============================================================================
-- 0021 TWO-STEP LOGIN FOR ADMINS (Supabase Auth MFA, authenticator app / TOTP)
--   Admin permissions now require a session that passed the second step
--   (JWT claim aal = 'aal2'). A stolen password alone (aal1) gives no admin
--   access — not in the app and not through the database API.
--   Customer access is unchanged.
-- =============================================================================

create or replace function private.mfa_verified()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
$$;
grant execute on function private.mfa_verified() to authenticated, service_role;

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
  where p.id = (select auth.uid()) and p.is_active and private.mfa_verified()
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.mfa_verified() and exists (
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
  select private.mfa_verified() and exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = (select auth.uid())
      and p.is_active
      and rp.permission_key = p_permission
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
    'permissions', coalesce((
      select jsonb_agg(rp.permission_key order by rp.permission_key)
      from public.role_permissions rp where rp.role_id = p.role_id
    ), '[]'::jsonb)
  ) end
  from (select 1) d
  left join public.profiles p on p.id = (select auth.uid()) and p.is_active and private.mfa_verified()
  left join public.admin_roles r on r.id = p.role_id
$$;

-- Is the signed-in user an active staff member? (No second step needed: used
-- by the sign-in flow to decide whether to ask for the code.)
create or replace function public.my_staff_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'staff', exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active),
    'mfa_verified', private.mfa_verified())
$$;
revoke execute on function public.my_staff_status() from public, anon;
grant execute on function public.my_staff_status() to authenticated;

-- Audit entry when a Super Admin resets a staff member's authenticator
-- (the factor itself is removed through Supabase Auth by the app).
create or replace function public.admin_log_mfa_reset(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('staff.manage');
  if p_user_id = (select auth.uid()) then perform private.app_error('cannot_modify_self'); end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then perform private.app_error('user_not_found'); end if;
  perform private.audit('mfa_reset', 'profiles', p_user_id::text);
end;
$$;
revoke execute on function public.admin_log_mfa_reset(uuid) from public, anon;
grant execute on function public.admin_log_mfa_reset(uuid) to authenticated;
