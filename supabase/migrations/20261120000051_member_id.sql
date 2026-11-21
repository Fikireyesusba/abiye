-- 0051: a unique, random member ID for every account (customers AND staff).
--
-- 6 characters of capital letters and digits, e.g. K7Q2X9. Characters that are
-- easy to confuse (0/O, 1/I/L) are never used. Given automatically when an
-- account is created; existing accounts get one now. It never changes, and
-- customers cannot change it (they may only update their own name / phone /
-- delivery columns). Staff search customers by it.

-- 1. Generator: random until unused.
create or replace function private.new_member_id()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_id text;
begin
  loop
    v_id := '';
    for i in 1..6 loop
      v_id := v_id || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.customer_accounts where member_id = v_id);
  end loop;
  return v_id;
end;
$$;
revoke all on function private.new_member_id() from public, anon, authenticated;

-- 2. Column, filled for everyone who already has an account.
alter table public.customer_accounts add column if not exists member_id text;

do $$
declare r record;
begin
  -- every sign-in account has a customer_accounts row (staff included)
  insert into public.customer_accounts (id) select u.id from auth.users u on conflict (id) do nothing;
  for r in select id from public.customer_accounts where member_id is null loop
    update public.customer_accounts set member_id = private.new_member_id() where id = r.id;
  end loop;
end;
$$;

alter table public.customer_accounts alter column member_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_accounts_member_id_key') then
    alter table public.customer_accounts add constraint customer_accounts_member_id_key unique (member_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_accounts_member_id_format') then
    alter table public.customer_accounts add constraint customer_accounts_member_id_format
      check (member_id ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$');
  end if;
end;
$$;

-- 3. New accounts get one automatically; it can never be changed afterwards.
create or replace function private.member_id_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.member_id := private.new_member_id();   -- always generated, never chosen
  elsif new.member_id is distinct from old.member_id then
    new.member_id := old.member_id;
  end if;
  return new;
end;
$$;
revoke all on function private.member_id_guard() from public, anon, authenticated;

drop trigger if exists customer_accounts_member_id on public.customer_accounts;
create trigger customer_accounts_member_id
  before insert or update on public.customer_accounts
  for each row execute function private.member_id_guard();

-- 4. Admin customer list: shows the member ID and searches by it.
drop function if exists public.admin_customer_accounts(text, integer, uuid);
create function public.admin_customer_accounts(p_search text default null, p_limit integer default 100, p_user_id uuid default null)
returns table (
  id uuid, email text, full_name text, phone text, created_at timestamptz,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz, is_staff boolean,
  order_count bigint, last_order_at timestamptz,
  deactivated_at timestamptz, deactivation_reason text, deactivated_by_name text,
  member_id text
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
           false as is_staff,
           (select count(*) from public.orders o where o.user_id = u.id) as order_count,
           (select max(o.created_at) from public.orders o where o.user_id = u.id) as last_order_at,
           c.deactivated_at, c.deactivation_reason,
           (select p.full_name from public.profiles p where p.id = c.deactivated_by),
           c.member_id
    from auth.users u
    left join public.customer_accounts c on c.id = u.id
    where not exists (select 1 from public.profiles p where p.id = u.id)   -- staff: see Staff
      and (p_user_id is null or u.id = p_user_id)
      and (v_q is null
       or u.email ilike '%' || v_q || '%'
       or c.full_name ilike '%' || v_q || '%'
       or c.phone ilike '%' || v_q || '%'
       or c.member_id = upper(v_q))
    order by u.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;
revoke all on function public.admin_customer_accounts(text, integer, uuid) from public, anon;
grant execute on function public.admin_customer_accounts(text, integer, uuid) to authenticated;
