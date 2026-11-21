-- =============================================================================
-- 0042 STAFF: DEACTIVATE AND DELETE (Super Admin)
-- "Delete" removes a staff member for good: no dashboard access, hidden from
-- the Staff list, cannot be switched back on. The profile row is KEPT (marked
-- removed) so history — activity log, order notes, payment decisions — still
-- shows who did what. The server action also blocks their sign-in.
-- =============================================================================
alter table public.profiles
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users(id) on delete set null;
alter table public.profiles add constraint profiles_removed_inactive check (removed_at is null or not is_active);

-- Role / access changes: removed staff cannot be changed or switched back on.
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
  -- (The profiles audit trigger records every change, incl. the Telegram copy.)
  update public.profiles set role_id = v_role, is_active = p_is_active where id = p_user_id and removed_at is null;
  if not found then perform private.app_error('not_found'); end if;
  if not exists (select 1 from public.profiles where role_id = v_super and is_active) then
    perform private.app_error('last_super_admin');
  end if;
end;
$$;
revoke all on function public.admin_set_staff_role(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_staff_role(uuid, text, boolean) to authenticated;

-- Delete (remove for good). Returns the staff member's name for the message.
create or replace function public.admin_remove_staff(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_super smallint;
  v_p public.profiles;
begin
  perform private.require_permission('staff.manage');
  if p_user_id = (select auth.uid()) then perform private.app_error('cannot_modify_self'); end if;
  select id into v_super from public.admin_roles where key = 'super_admin';
  perform pg_advisory_xact_lock(hashtext('staff_roles'));
  select * into v_p from public.profiles where id = p_user_id and removed_at is null for update;
  if not found then perform private.app_error('not_found'); end if;
  -- Recorded by the profiles audit trigger (activity log + Telegram admin feed).
  update public.profiles set is_active = false, removed_at = now(), removed_by = (select auth.uid()) where id = p_user_id;
  if not exists (select 1 from public.profiles where role_id = v_super and is_active) then
    perform private.app_error('last_super_admin');
  end if;
  -- Unassign their open work so nothing is stuck with someone who has left.
  update public.orders set assigned_to = null where assigned_to = p_user_id
     and status not in ('completed', 'cancelled', 'expired');
  update public.printing_jobs set assigned_to = null where assigned_to = p_user_id
     and status not in ('completed', 'cancelled');
  return v_p.full_name;
end;
$$;
revoke all on function public.admin_remove_staff(uuid) from public, anon;
grant execute on function public.admin_remove_staff(uuid) to authenticated;
