-- =============================================================================
-- 0033 SALES REPORTS (daily closing / monthly statement), Super Admin (analytics.view).
--   Money is counted when the payment was VERIFIED (matches the bank statement), in
--   Addis Ababa days. Read-only; exports are recorded via admin_log_export('sales').
-- =============================================================================

create or replace function public.admin_sales_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v jsonb;
begin
  perform private.require_permission('analytics.view');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform private.app_error('invalid_request');
  end if;
  v_from := p_from::timestamp at time zone 'Africa/Addis_Ababa';
  v_to   := (p_to + 1)::timestamp at time zone 'Africa/Addis_Ababa';

  with
  placed as (select * from public.orders where created_at >= v_from and created_at < v_to),
  paid as (select * from public.orders where payment_verified_at >= v_from and payment_verified_at < v_to
             and payment_status in ('verified', 'refunded')),
  paid_items as (select i.* from public.order_items i join paid o on o.id = i.order_id),
  topups as (select * from public.wallet_topups where status = 'verified' and reviewed_at >= v_from and reviewed_at < v_to),
  cancelled_paid as (
    select o.*, h.created_at as cancelled_on from public.orders o
      join lateral (select created_at from public.order_status_history
                     where order_id = o.id and to_status = 'cancelled' order by id desc limit 1) h on true
     where o.status = 'cancelled' and o.payment_verified_at is not null
       and h.created_at >= v_from and h.created_at < v_to),
  wallet_refunds as (select * from public.wallet_ledger where kind = 'refund' and created_at >= v_from and created_at < v_to),
  days as (select generate_series(p_from::timestamp, p_to::timestamp, interval '1 day')::date as d),
  addis as (select o.*, (o.payment_verified_at at time zone 'Africa/Addis_Ababa')::date as d from paid o)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', jsonb_build_object(
      'orders_placed', (select count(*) from placed),
      'orders_paid', (select count(*) from paid),
      'sales', (select coalesce(sum(total_etb), 0) from paid),
      'products_sales', (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'product'),
      'printing_sales', (select coalesce(sum(line_total_etb), 0) from paid_items where item_type = 'printing'),
      'delivery_fees', (select coalesce(sum(delivery_fee_etb), 0) from paid),
      'discounts', (select coalesce(sum(discount_etb), 0) from paid),
      'average_order', (select coalesce(round(avg(total_etb), 2), 0) from paid),
      'paid_by_bank', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'bank_transfer'),
      'paid_by_wallet', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'wallet'),
      'topups_count', (select count(*) from topups),
      'topups_amount', (select coalesce(sum(amount_etb), 0) from topups),
      'cash_in', (select coalesce(sum(total_etb), 0) from paid where payment_method = 'bank_transfer')
                 + (select coalesce(sum(amount_etb), 0) from topups),
      'cancelled_after_payment_count', (select count(*) from cancelled_paid),
      'cancelled_after_payment_bank', (select coalesce(sum(total_etb), 0) from cancelled_paid where payment_method = 'bank_transfer'),
      'wallet_refunds', (select coalesce(sum(amount_etb), 0) from wallet_refunds)),
    'by_bank', (
      select coalesce(jsonb_agg(x order by x ->> 'bank', x ->> 'account'), '[]'::jsonb) from (
        select jsonb_build_object('bank', bank, 'account', account,
                 'orders', sum(orders), 'orders_amount', sum(orders_amount), 'topups', sum(topups), 'topups_amount', sum(topups_amount),
                 'total', sum(orders_amount) + sum(topups_amount)) as x
          from (
            select coalesce(bank_snapshot ->> 'bank_name', '—') as bank, coalesce(bank_snapshot ->> 'account_number', '—') as account,
                   count(*) as orders, sum(total_etb) as orders_amount, 0 as topups, 0::numeric as topups_amount
              from paid where payment_method = 'bank_transfer' group by 1, 2
            union all
            select coalesce(bank_snapshot ->> 'bank_name', '—'), coalesce(bank_snapshot ->> 'account_number', '—'), 0, 0, count(*), sum(amount_etb)
              from topups group by 1, 2) u
         group by bank, account) t),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', dd.d,
               'placed', (select count(*) from placed o where (o.created_at at time zone 'Africa/Addis_Ababa')::date = dd.d),
               'paid', (select count(*) from addis a where a.d = dd.d),
               'sales', (select coalesce(sum(a.total_etb), 0) from addis a where a.d = dd.d),
               'bank', (select coalesce(sum(a.total_etb), 0) from addis a where a.d = dd.d and a.payment_method = 'bank_transfer'),
               'wallet', (select coalesce(sum(a.total_etb), 0) from addis a where a.d = dd.d and a.payment_method = 'wallet'),
               'topups', (select coalesce(sum(t.amount_etb), 0) from topups t where (t.reviewed_at at time zone 'Africa/Addis_Ababa')::date = dd.d))
             order by dd.d), '[]'::jsonb) from days dd),
    'by_staff', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'payments', n, 'amount', amount) order by n desc), '[]'::jsonb) from (
        select private.actor_name(payment_verified_by) as name, count(*) as n, sum(total_etb) as amount
          from paid where payment_method = 'bank_transfer' group by payment_verified_by) s),
    'top_products', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name_en, 'sku', sku, 'quantity', q, 'amount', amount) order by q desc, amount desc), '[]'::jsonb) from (
        select name_en, sku, sum(quantity) as q, sum(line_total_etb) as amount
          from paid_items where item_type = 'product' group by name_en, sku order by 3 desc, 4 desc limit 15) tp),
    'cancelled_after_payment', (
      select coalesce(jsonb_agg(jsonb_build_object('order_number', c.order_number, 'total', c.total_etb, 'method', c.payment_method,
               'cancelled_at', c.cancelled_on, 'customer', c.customer_name) order by c.cancelled_on), '[]'::jsonb)
        from cancelled_paid c)
  ) into v;
  return v;
end;
$$;

-- Record sales exports too.
create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'orders' then perform private.require_permission('orders.view_all');
  elsif p_kind = 'activity' then perform private.require_permission('audit.view');
  elsif p_kind = 'payments' then perform private.require_permission('payments.view');
  elsif p_kind = 'sales' then perform private.require_permission('analytics.view');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;

revoke all on function public.admin_sales_report(date, date) from public, anon;
grant execute on function public.admin_sales_report(date, date) to authenticated;
