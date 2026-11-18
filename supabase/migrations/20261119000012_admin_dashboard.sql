-- =============================================================================
-- 0012 ADMIN DASHBOARD STATS
-- One permission-aware aggregate call for the dashboard. Every figure is
-- scoped to what the caller may see:
--   * revenue only with analytics.view (Super Admin by default)
--   * staff (orders.view_assigned without view_all) count only assigned orders
--   * stock / printing / payment figures only with the matching permission
-- Days are calendar days in Africa/Addis_Ababa.
-- =============================================================================
create or replace function public.admin_dashboard_stats(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_all       boolean := private.has_permission('orders.view_all');
  v_assigned  boolean := private.has_permission('orders.view_assigned');
  v_revenue   boolean := private.has_permission('analytics.view');
  v_days      integer := greatest(1, least(coalesce(p_days, 14), 90));
  v_today     date := (now() at time zone 'Africa/Addis_Ababa')::date;
  v_result    jsonb;
begin
  perform private.require_permission('dashboard.view');

  with visible as (
    select o.* from public.orders o
    where v_all or (v_assigned and o.assigned_to = v_uid)
  )
  select jsonb_build_object(
    'orders_total', (select count(*) from visible),
    'orders_today', (select count(*) from visible where (created_at at time zone 'Africa/Addis_Ababa')::date = v_today),
    'awaiting_processing', (select count(*) from visible where status in ('confirmed', 'processing')),
    'awaiting_payment', (select count(*) from visible where status in ('awaiting_payment', 'payment_rejected')),
    'pending_payments', case when private.has_permission('payments.view')
        then (select count(*) from public.payment_submissions where status = 'pending') end,
    'products_active', case when private.has_permission('products.view')
        then (select count(*) from public.products where status = 'active') end,
    'low_stock', case when private.has_permission('products.view') or private.has_permission('inventory.manage')
        then (select count(*) from public.products where status = 'active' and track_inventory
              and stock_quantity > 0 and stock_quantity <= low_stock_threshold) end,
    'out_of_stock', case when private.has_permission('products.view') or private.has_permission('inventory.manage')
        then (select count(*) from public.products where status = 'active' and track_inventory and stock_quantity = 0) end,
    'printing_open', case when private.has_permission('printing.view')
        then (select count(*) from public.printing_jobs where status not in ('completed', 'cancelled')) end,
    'revenue_verified_total', case when v_revenue
        then (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified') end,
    'revenue_verified_period', case when v_revenue
        then (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified'
              and (payment_verified_at at time zone 'Africa/Addis_Ababa')::date > v_today - v_days) end,
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'day', d.day,
               'orders', (select count(*) from visible v where (v.created_at at time zone 'Africa/Addis_Ababa')::date = d.day),
               'revenue', case when v_revenue then (
                   select coalesce(sum(o.total_etb), 0) from public.orders o
                    where o.payment_status = 'verified'
                      and (o.payment_verified_at at time zone 'Africa/Addis_Ababa')::date = d.day) end)
             order by d.day)
      from (select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as day) d
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_dashboard_stats(integer) from public, anon;
grant execute on function public.admin_dashboard_stats(integer) to authenticated;
