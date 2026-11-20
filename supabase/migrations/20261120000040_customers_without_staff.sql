-- =============================================================================
-- 0040 STAFF ARE NOT LISTED UNDER CUSTOMERS
--   Staff accounts (in profiles) are managed only under Staff. The customer list,
--   search and customer pages no longer include them. (is_staff is kept, always false.)
-- =============================================================================

create or replace function public.admin_customer_accounts(p_search text default null, p_limit integer default 100, p_user_id uuid default null)
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
           false as is_staff,
           (select count(*) from public.orders o where o.user_id = u.id) as order_count,
           (select max(o.created_at) from public.orders o where o.user_id = u.id) as last_order_at,
           c.deactivated_at, c.deactivation_reason,
           (select p.full_name from public.profiles p where p.id = c.deactivated_by)
    from auth.users u
    left join public.customer_accounts c on c.id = u.id
    where not exists (select 1 from public.profiles p where p.id = u.id)   -- staff: see Staff
      and (p_user_id is null or u.id = p_user_id)
      and (v_q is null
       or u.email ilike '%' || v_q || '%'
       or c.full_name ilike '%' || v_q || '%'
       or c.phone ilike '%' || v_q || '%')
    order by u.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- Is this id a staff account? (lets the customer page send you to Staff instead.)
create or replace function public.admin_is_staff_account(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('customers.view');
  return exists (select 1 from public.profiles where id = p_user_id);
end;
$$;
revoke all on function public.admin_is_staff_account(uuid) from public, anon;
grant execute on function public.admin_is_staff_account(uuid) to authenticated;
