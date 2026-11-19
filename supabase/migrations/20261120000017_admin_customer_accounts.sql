-- =============================================================================
-- 0017 ADMIN: registered customer accounts
-- Emails live in auth.users (not exposed to the API). Staff holding
-- customers.view get them through these permission-checked functions only.
-- =============================================================================

create or replace function public.admin_customer_accounts(p_search text default null, p_limit integer default 100, p_user_id uuid default null)
returns table (
  id uuid, email text, full_name text, phone text, created_at timestamptz,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz, is_staff boolean,
  order_count bigint, last_order_at timestamptz
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
           exists (select 1 from public.profiles p where p.id = u.id) as is_staff,
           (select count(*) from public.orders o where o.user_id = u.id) as order_count,
           (select max(o.created_at) from public.orders o where o.user_id = u.id) as last_order_at
    from auth.users u
    left join public.customer_accounts c on c.id = u.id
    where (p_user_id is null or u.id = p_user_id)
      and (v_q is null
       or u.email ilike '%' || v_q || '%'
       or c.full_name ilike '%' || v_q || '%'
       or c.phone ilike '%' || v_q || '%')
    order by u.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.admin_customer_accounts(text, integer, uuid) from public, anon;
grant execute on function public.admin_customer_accounts(text, integer, uuid) to authenticated;
