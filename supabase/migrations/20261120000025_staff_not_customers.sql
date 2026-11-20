-- =============================================================================
-- 0025 STAFF ACCOUNTS ARE NOT CUSTOMER ACCOUNTS
--   Admin/staff logins cannot place orders or printing jobs (the app also
--   refuses them on the customer sign-in). Staff shop with a separate email.
-- =============================================================================

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
  if exists (select 1 from public.profiles where id = p_user_id) then
    perform private.app_error('staff_account');
  end if;
end;
$$;
