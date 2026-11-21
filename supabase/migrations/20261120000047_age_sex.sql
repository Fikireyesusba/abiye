-- =============================================================================
-- 0047 DATE OF BIRTH AND SEX (customers and staff)
--   * Customers can give them at sign-up or once on My account; afterwards only
--     staff change them (same lock as name and phone).
--   * Staff: set by a Super Admin (Staff → Personal details).
-- =============================================================================
alter table public.customer_accounts
  add column date_of_birth date check (date_of_birth >= date '1900-01-01'),
  add column sex text check (sex in ('female', 'male'));
grant update (date_of_birth, sex) on public.customer_accounts to authenticated;

alter table public.profiles
  add column date_of_birth date check (date_of_birth >= date '1900-01-01'),
  add column sex text check (sex in ('female', 'male'));

-- Lock: set once by the customer, then only by staff.
create or replace function private.customer_details_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Staff tools are security definer functions (they do not run as "authenticated").
  if current_user <> 'authenticated' then return new; end if;
  if nullif(btrim(coalesce(old.full_name, '')), '') is not null then new.full_name := old.full_name; end if;
  if old.phone is not null then new.phone := old.phone; end if;
  if old.date_of_birth is not null then new.date_of_birth := old.date_of_birth; end if;
  if old.sex is not null then new.sex := old.sex; end if;
  if new.date_of_birth is not null and new.date_of_birth > (current_date - interval '10 years')::date then
    raise exception using errcode = 'P0001', message = 'invalid_request', detail = 'date of birth';
  end if;
  return new;
end;
$$;

-- Sign-up: optional date of birth and sex from the form.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dob date;
begin
  begin
    v_dob := nullif(new.raw_user_meta_data ->> 'date_of_birth', '')::date;
    if v_dob not between date '1900-01-01' and (current_date - interval '10 years')::date then v_dob := null; end if;
  exception when others then v_dob := null;
  end;
  insert into public.customer_accounts (id, full_name, accepted_terms_at, date_of_birth, sex)
  values (
    new.id,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), 120),
    case when (new.raw_user_meta_data ->> 'accepted_terms') = 'true' then now() end,
    v_dob,
    case when new.raw_user_meta_data ->> 'sex' in ('female', 'male') then new.raw_user_meta_data ->> 'sex' end)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Staff change a customer's details (now with date of birth and sex).
drop function if exists public.admin_update_customer_details(uuid, text, text, text);
create or replace function public.admin_update_customer_details(
  p_user_id uuid, p_full_name text, p_phone text, p_old_email text default null, p_date_of_birth date default null, p_sex text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.customer_accounts;
begin
  perform private.require_permission('customers.manage');
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then perform private.app_error('not_found'); end if;
  if exists (select 1 from public.profiles where id = p_user_id) then perform private.app_error('invalid_request', 'staff account'); end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 2 and 120 then perform private.app_error('invalid_name'); end if;
  if p_phone is not null and p_phone !~ '^\+251[79][0-9]{8}$' then perform private.app_error('invalid_phone'); end if;
  if p_sex is not null and p_sex not in ('female', 'male') then perform private.app_error('invalid_request', 'sex'); end if;
  if p_date_of_birth is not null and p_date_of_birth not between date '1900-01-01' and (current_date - interval '10 years')::date then
    perform private.app_error('invalid_request', 'date of birth');
  end if;
  insert into public.customer_accounts (id) values (p_user_id) on conflict do nothing;
  select * into v_before from public.customer_accounts where id = p_user_id for update;
  update public.customer_accounts
     set full_name = btrim(p_full_name), phone = p_phone, date_of_birth = p_date_of_birth, sex = p_sex
   where id = p_user_id;
  perform private.audit('profile_updated', 'customer_account', p_user_id::text,
    jsonb_strip_nulls(jsonb_build_object('full_name', v_before.full_name, 'phone', v_before.phone, 'email', p_old_email,
      'date_of_birth', v_before.date_of_birth, 'sex', v_before.sex)),
    jsonb_strip_nulls(jsonb_build_object('full_name', btrim(p_full_name), 'phone', p_phone,
      'email', case when p_old_email is not null then (select u.email::text from auth.users u where u.id = p_user_id) end,
      'date_of_birth', p_date_of_birth, 'sex', p_sex)),
    jsonb_build_object('by', 'staff'));
end;
$$;
revoke all on function public.admin_update_customer_details(uuid, text, text, text, date, text) from public, anon;
grant execute on function public.admin_update_customer_details(uuid, text, text, text, date, text) to authenticated;

-- Super Admin: a staff member's personal details (recorded by the profiles audit trigger).
create or replace function public.admin_update_staff_details(p_user_id uuid, p_full_name text, p_phone text, p_date_of_birth date, p_sex text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('staff.manage');
  if char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 120 then perform private.app_error('invalid_name'); end if;
  if p_phone is not null and p_phone !~ '^\+251[79][0-9]{8}$' then perform private.app_error('invalid_phone'); end if;
  if p_sex is not null and p_sex not in ('female', 'male') then perform private.app_error('invalid_request', 'sex'); end if;
  if p_date_of_birth is not null and p_date_of_birth not between date '1900-01-01' and (current_date - interval '14 years')::date then
    perform private.app_error('invalid_request', 'date of birth');
  end if;
  update public.profiles
     set full_name = btrim(p_full_name), phone = p_phone, date_of_birth = p_date_of_birth, sex = p_sex
   where id = p_user_id and removed_at is null;
  if not found then perform private.app_error('not_found'); end if;
end;
$$;
revoke all on function public.admin_update_staff_details(uuid, text, text, date, text) from public, anon;
grant execute on function public.admin_update_staff_details(uuid, text, text, date, text) to authenticated;
