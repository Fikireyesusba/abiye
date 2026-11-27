-- =============================================================================
-- 0077 MONITORING METRICS (Grafana)
--   One function returning only totals (no names, phones, emails or order details) for the private,
--   token-protected metrics link /api/metrics that Grafana Cloud reads every minute.
--   Callable by the server (service role) only.
-- =============================================================================

create or replace function public.metrics_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' as day,
           date_trunc('month', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' as month
  )
  select jsonb_build_object(
    'orders_by_status', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
        select status::text as s, count(*) as n from public.orders
         where status not in ('completed', 'cancelled', 'expired') or updated_at >= (select day from t) group by 1) x),
    'orders_paid_today', (select count(*) from public.orders where payment_verified_at >= (select day from t)),
    'orders_created_today', (select count(*) from public.orders where created_at >= (select day from t)),
    'orders_completed_today', (select count(*) from public.orders where status = 'completed' and updated_at >= (select day from t)),
    'orders_cancelled_today', (select count(*) from public.orders where status = 'cancelled' and cancelled_at >= (select day from t)),
    'revenue_today_etb', (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified' and payment_verified_at >= (select day from t)),
    'revenue_month_etb', (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified' and payment_verified_at >= (select month from t)),
    'payments_pending', (select count(*) from public.payment_submissions where status = 'pending'),
    'payments_oldest_pending_minutes', (select coalesce(extract(epoch from now() - min(submitted_at)) / 60, 0)::int from public.payment_submissions where status = 'pending'),
    'topups_pending', (select count(*) from public.wallet_topups where status = 'pending'),
    'deliveries', (select jsonb_build_object(
        'waiting_courier', count(*) filter (where status in ('confirmed', 'processing') and courier_id is null),
        'to_pick_up', count(*) filter (where status in ('confirmed', 'processing') and courier_id is not null),
        'on_the_way', count(*) filter (where status = 'out_for_delivery'),
        'at_partner_shops', count(*) filter (where status = 'ready_for_pickup' and partner_shop_id is not null),
        'locked', count(*) filter (where status in ('out_for_delivery', 'ready_for_pickup') and (delivery_code_tries >= 5 or handoff_tries >= 5)))
        from public.orders where payment_status = 'verified' and (fulfillment_method = 'delivery' or partner_shop_id is not null)
          and status in ('confirmed', 'processing', 'out_for_delivery', 'ready_for_pickup')),
    'deliveries_late', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) as n from private.delivery_overdue() group by 1) x),
    'delivered_today', (select count(*) from public.orders where status = 'completed' and delivered_at >= (select day from t)),
    'couriers_online', (select count(*) from public.courier_profiles cp join public.profiles p on p.id = cp.profile_id and p.is_active where cp.on_duty),
    'couriers_active', (select count(*) from public.profiles p join public.admin_roles r on r.id = p.role_id and r.key = 'courier' where p.is_active and p.removed_at is null),
    'wrong_pins_today', (select count(*) from public.audit_logs where action = 'pin_wrong' and created_at >= (select day from t)),
    'printing_jobs', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
        select status::text as s, count(*) as n from public.printing_jobs where status not in ('completed', 'cancelled') group by 1) x),
    'support_open', (select count(*) from public.support_tickets where status in ('open', 'in_progress')),
    'accounts_pending_approval', (select count(*) from public.customer_accounts where approval_status = 'pending'),
    'signups_today', (select count(*) from public.customer_accounts where created_at >= (select day from t)),
    'customers_total', (select count(*) from public.customer_accounts),
    'products_active', (select count(*) from public.products where status = 'active'),
    'products_low_stock', (select count(*) from public.products where status = 'active' and track_inventory and stock_quantity > 0 and stock_quantity <= low_stock_threshold),
    'products_out_of_stock', (select count(*) from public.products where status = 'active' and track_inventory and stock_quantity <= 0),
    'notifications_24h', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
        select status::text as s, count(*) as n from public.notifications_outbox where created_at > now() - interval '24 hours' group by 1) x),
    'notifications_backlog', (select count(*) from public.notifications_outbox where status in ('pending', 'failed') and created_at < now() - interval '10 minutes'),
    'security_events_24h', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select kind, count(*) as n from public.security_events where created_at > now() - interval '24 hours' group by 1) x),
    'upload_scans_24h', (select coalesce(jsonb_object_agg(result, n), '{}'::jsonb) from (
        select result, count(*) as n from public.upload_scans where created_at > now() - interval '24 hours' group by 1) x),
    'documents_expiring_30d', (select count(*) from private.expiring_items(30) where expires_on >= current_date),
    'documents_expired', (select count(*) from private.expiring_items(0) where expires_on < current_date),
    'cron_last_run_age_seconds', (select coalesce(jsonb_object_agg(name, extract(epoch from now() - last_run_at)::int), '{}'::jsonb) from public.cron_runs),
    'cron_last_ok', (select coalesce(jsonb_object_agg(name, case when last_ok then 1 else 0 end), '{}'::jsonb) from public.cron_runs),
    'monitor_last_scan_age_seconds', coalesce(extract(epoch from now() - nullif(private.setting('delivery_monitor') ->> 'last_scan_at', '')::timestamptz)::int, -1),
    'database_size_bytes', pg_database_size(current_database()),
    'at', now())
$$;
revoke all on function public.metrics_snapshot() from public, anon, authenticated;
grant execute on function public.metrics_snapshot() to service_role;
