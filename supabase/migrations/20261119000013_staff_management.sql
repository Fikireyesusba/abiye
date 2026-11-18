-- =============================================================================
-- 0013 STAFF MANAGEMENT
-- The auth account is created server-side with the secret key (Supabase Auth
-- admin API); the PROFILE (which grants admin access) is created through this
-- function under the inviting admin's own session, so the permission check and
-- the audit log record who granted access.
-- =============================================================================
create or replace function public.admin_create_staff_profile(p_user_id uuid, p_full_name text, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role smallint;
begin
  perform private.require_permission('staff.manage');
  select id into v_role from public.admin_roles where key = p_role_key;
  if not found then perform private.app_error('invalid_role'); end if;
  if not exists (select 1 from auth.users where id = p_user_id) then perform private.app_error('user_not_found'); end if;
  if exists (select 1 from public.profiles where id = p_user_id) then perform private.app_error('invalid_request', 'profile exists'); end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 120 then perform private.app_error('invalid_name'); end if;
  insert into public.profiles (id, full_name, role_id, created_by)
  values (p_user_id, btrim(p_full_name), v_role, (select auth.uid()));
end;
$$;
revoke execute on function public.admin_create_staff_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_create_staff_profile(uuid, text, text) to authenticated;
