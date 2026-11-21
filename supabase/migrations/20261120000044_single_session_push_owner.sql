-- =============================================================================
-- 0044 ONE DEVICE PER ACCOUNT, ONE REVIEW AT A TIME, PUSH TO THE LATEST ACCOUNT
--   * Signing in on a new device/browser ends the account's other sessions
--     (the app calls Supabase sign-out "others"; the session rows are deleted).
--     private.session_alive() makes the database refuse a token whose session
--     was ended, even before the token expires: staff lose every permission and
--     customers can no longer act (orders, wallet, reviews …).
--   * Security alerts are cleared one at a time (no bulk "mark all").
--   * A device's phone notifications belong to the account that signed in on
--     it most recently (claim_push_device moves the device).
-- =============================================================================

-- Is the session this token belongs to still open? (Tokens always carry session_id.)
create or replace function private.session_alive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when nullif(auth.jwt() ->> 'session_id', '') is null then true
              else exists (select 1 from auth.sessions s where s.id = (auth.jwt() ->> 'session_id')::uuid) end
$$;
revoke all on function private.session_alive() from public, anon;
grant execute on function private.session_alive() to authenticated, service_role;

-- Staff: every permission check (has_permission, is_admin, current_role_key) goes through this.
create or replace function private.mfa_verified()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2' and private.session_alive()
$$;

-- Customers.
create or replace function private.is_active_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user((select auth.uid())) and private.session_alive()
$$;

-- For the website: is my session still the open one? (false = signed in elsewhere / signed out)
create or replace function public.session_is_current()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and private.session_alive()
$$;
revoke all on function public.session_is_current() from public, anon;
grant execute on function public.session_is_current() to authenticated;

-- One alert at a time.
create or replace function public.admin_mark_security_reviewed(p_type text, p_subjects text[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.require_permission('security.manage');
  if p_type not in ('email', 'customer') or p_subjects is null or cardinality(p_subjects) <> 1 then
    perform private.app_error('invalid_request', 'review one alert at a time');
  end if;
  if p_note is not null and char_length(p_note) > 500 then perform private.app_error('invalid_request', 'note'); end if;
  insert into public.security_reviews (subject_type, subject, reviewed_at, reviewed_by, note)
  select p_type, lower(btrim(s)), now(), auth.uid(), nullif(btrim(p_note), '')
    from unnest(p_subjects) s
   where char_length(btrim(s)) between 3 and 320
  on conflict (subject_type, subject) do update set reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by, note = excluded.note;
  get diagnostics v_n = row_count;
  perform private.audit('security_reviewed', 'security', p_type, null, null,
                        jsonb_build_object('type', p_type, 'count', v_n, 'subjects', to_jsonb(p_subjects), 'note', p_note));
  return v_n;
end;
$$;

-- This device now notifies the signed-in customer only (taken from any other account).
create or replace function public.claim_push_device(p_endpoint text, p_p256dh text, p_auth text, p_locale text default 'en')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_customer() then perform private.app_error('login_required'); end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  -- Column checks (allowed push services, key formats) apply to this insert.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, locale)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, case when p_locale = 'am' then 'am' else 'en' end);
end;
$$;
revoke all on function public.claim_push_device(text, text, text, text) from public, anon;
grant execute on function public.claim_push_device(text, text, text, text) to authenticated;
