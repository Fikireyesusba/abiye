-- =============================================================================
-- 0038 ACTIVITY LOG CATEGORIES
--   Orders & printing · Payments & wallet · Customers · Products & catalog ·
--   Staff & settings · Security & data. Counts per category and a filtered list.
-- =============================================================================

create or replace function private.activity_category(p_action text, p_entity_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_entity_type in ('security', 'audit', 'data', 'export') or p_action like 'export\_%' then 'security'
    when p_entity_type = 'payment_submission' or p_action like 'topup\_%' or p_action like 'payment\_%' or p_action = 'wallet_adjusted' then 'payments'
    when p_entity_type in ('order', 'printing_job') then 'orders'
    when p_entity_type = 'customer_account' then 'customers'
    when p_entity_type in ('products', 'categories', 'promotions', 'delivery_zones', 'printing_price_rules', 'homepage_banners',
                           'product_review', 'product_images') then 'catalog'
    when p_entity_type in ('profiles', 'role_permissions', 'website_settings', 'bank_accounts', 'notification') then 'staff'
    else 'other'
  end
$$;

-- Counts and latest entry per category over the last p_days days.
create or replace function public.admin_activity_categories(p_days integer default 30)
returns table (category text, total bigint, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  return query
    select private.activity_category(a.action, a.entity_type), count(*), max(a.created_at)
      from public.audit_logs a
     where a.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)))
     group by 1;
end;
$$;

-- The activity list of one category (or all when null), newest first, with paging.
create or replace function public.admin_activity_by_category(
  p_category text default null, p_search text default null, p_limit integer default 100, p_before_id bigint default null)
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
       and (v_q is null or a.action ilike '%' || v_q || '%' or a.entity_id ilike '%' || v_q || '%'
            or private.actor_name(a.actor_id) ilike '%' || v_q || '%')
     order by a.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.admin_activity_categories(integer) from public, anon;
revoke all on function public.admin_activity_by_category(text, text, integer, bigint) from public, anon;
grant execute on function public.admin_activity_categories(integer) to authenticated;
grant execute on function public.admin_activity_by_category(text, text, integer, bigint) to authenticated;
