-- 0056:
--   * An order (and a printing order) exists for the customer and staff only once its payment is
--     accepted: no customer message for a checkout that was never paid (placed / expired / cancelled);
--     the dashboard counts accepted orders only.
--   * Staff performance (KPIs) per staff member for a date range, with targets set by the Super Admin.

-- ============================================================ customer messages only for real (paid) orders
create or replace function private.email_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_note text;
begin
  if new.user_id is null then return new; end if;
  -- A checkout that is still being paid, expired or was cancelled before payment is not an order yet:
  -- no message (the payment details are on the checkout page).
  if tg_op = 'INSERT' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'cancelled' and old.status = 'payment_rejected' then return new; end if;
  if new.status in ('expired', 'cancelled') and new.payment_status not in ('verified', 'refunded') then return new; end if;
  v_event := case new.status
    when 'confirmed' then 'order_confirmed'
    when 'payment_rejected' then 'order_payment_rejected'
    when 'ready_for_pickup' then 'order_ready_for_pickup'
    when 'out_for_delivery' then 'order_out_for_delivery'
    when 'completed' then 'order_completed'
    when 'cancelled' then 'order_cancelled'
  end;
  if v_event is null then return new; end if;
  if v_event = 'order_payment_rejected' then
    select s.review_note into v_note from public.payment_submissions s
     where s.order_id = new.id and s.status = 'rejected' order by s.reviewed_at desc limit 1;
  end if;
  perform private.enqueue_customer_email(
    'customer_' || v_event,
    'email:' || v_event || ':' || new.id || ':' || (select count(*) from public.order_status_history h where h.order_id = new.id),
    new.user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_id', new.id, 'order_number', new.order_number, 'total_etb', new.total_etb,
      'fulfillment', new.fulfillment_method, 'locale', new.locale, 'note', v_note)));
  return new;
end;
$$;

-- Dashboard: accepted orders only.
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
  v_today     date := (now() at time zone 'Europe/Warsaw')::date;
  v_result    jsonb;
begin
  perform private.require_permission('dashboard.view');

  with visible as (
    -- An order exists once its payment is accepted (verified or later refunded).
    select o.*, coalesce(o.payment_verified_at, o.created_at) as accepted_at from public.orders o
    where (v_all or (v_assigned and o.assigned_to = v_uid))
      and o.payment_status in ('verified', 'refunded')
  )
  select jsonb_build_object(
    'orders_total', (select count(*) from visible),
    'orders_today', (select count(*) from visible where (accepted_at at time zone 'Europe/Warsaw')::date = v_today),
    'awaiting_processing', (select count(*) from visible where status in ('confirmed', 'processing')),
    'awaiting_payment', 0,
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
        then (select count(*) from public.printing_jobs where status in ('awaiting_quote', 'printing', 'ready')) end,
    'revenue_verified_total', case when v_revenue
        then (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified') end,
    'revenue_verified_period', case when v_revenue
        then (select coalesce(sum(total_etb), 0) from public.orders where payment_status = 'verified'
              and (payment_verified_at at time zone 'Europe/Warsaw')::date > v_today - v_days) end,
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'day', d.day,
               'orders', (select count(*) from visible v where (v.accepted_at at time zone 'Europe/Warsaw')::date = d.day),
               'revenue', case when v_revenue then (
                   select coalesce(sum(o.total_etb), 0) from public.orders o
                    where o.payment_status = 'verified'
                      and (o.payment_verified_at at time zone 'Europe/Warsaw')::date = d.day) end)
             order by d.day)
      from (select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as day) d
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ============================================================ staff performance (KPIs) and targets
insert into public.admin_permissions (key, description) values
  ('kpi.view', 'See staff performance (KPIs)'),
  ('kpi.manage', 'Set the KPI targets')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r cross join (values ('kpi.view'), ('kpi.manage')) p(key)
 where r.key = 'super_admin' or (r.key = 'manager' and p.key = 'kpi.view')
on conflict do nothing;

create table if not exists public.kpi_targets (
  id          uuid primary key default gen_random_uuid(),
  metric      text not null check (metric in ('tickets_resolved', 'ticket_resolution_hours', 'ticket_first_reply_hours', 'orders_completed',
                                              'payments_approved', 'payment_review_minutes', 'topups_approved', 'printing_completed', 'instore_sales')),
  period      text not null check (period in ('day', 'week', 'month')),
  profile_id  uuid references public.profiles(id) on delete cascade,   -- null = every staff member
  target      numeric(12,2) not null check (target >= 0 and target <= 1000000),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create unique index if not exists kpi_targets_unique on public.kpi_targets (metric, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.kpi_targets enable row level security;
revoke all on public.kpi_targets from anon, authenticated;
grant select on public.kpi_targets to authenticated;
drop policy if exists kpi_targets_read on public.kpi_targets;
create policy kpi_targets_read on public.kpi_targets for select to authenticated using ((select private.has_permission('kpi.view')));
drop trigger if exists kpi_targets_audit on public.kpi_targets;
create trigger kpi_targets_audit after insert or update or delete on public.kpi_targets
  for each row execute function private.audit_row_change();

create or replace function public.admin_save_kpi_target(p_metric text, p_period text, p_target numeric, p_profile_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('kpi.manage');
  if p_profile_id is not null and not exists (select 1 from public.profiles where id = p_profile_id and removed_at is null) then
    perform private.app_error('user_not_found');
  end if;
  if p_target is null or p_target < 0 or p_target > 1000000 then perform private.app_error('invalid_request', 'target'); end if;
  if p_period not in ('day', 'week', 'month') then perform private.app_error('invalid_request', 'period'); end if;
  insert into public.kpi_targets (metric, period, profile_id, target, updated_by)
  values (p_metric, p_period, p_profile_id, p_target, (select auth.uid()))
  on conflict (metric, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set period = excluded.period, target = excluded.target, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.admin_save_kpi_target(text, text, numeric, uuid) from public, anon;
grant execute on function public.admin_save_kpi_target(text, text, numeric, uuid) to authenticated;

create or replace function public.admin_delete_kpi_target(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('kpi.manage');
  delete from public.kpi_targets where id = p_id;
end;
$$;
revoke all on function public.admin_delete_kpi_target(uuid) from public, anon;
grant execute on function public.admin_delete_kpi_target(uuid) to authenticated;

-- One row per staff member for [p_from, p_to).
create or replace function public.admin_staff_kpis(p_from timestamptz, p_to timestamptz)
returns table (
  user_id uuid, member_id text, full_name text, role_name text, is_active boolean,
  tickets_resolved bigint, ticket_resolution_hours numeric, ticket_first_reply_hours numeric, ticket_replies bigint, ticket_rating numeric,
  orders_completed bigint, order_steps bigint,
  payments_approved bigint, payments_rejected bigint, payment_review_minutes numeric,
  topups_approved bigint, topups_rejected bigint,
  printing_completed bigint, instore_sales bigint, instore_sales_etb numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('kpi.view');
  if p_from is null or p_to is null or p_to <= p_from then perform private.app_error('invalid_request', 'dates'); end if;
  return query
  with staff as (
    select p.id, p.full_name, p.is_active, r.name as role_name from public.profiles p
      left join public.admin_roles r on r.id = p.role_id
     where p.removed_at is null
  ),
  resolved as (   -- status changed to resolved / closed by this person
    select a.actor_id, a.entity_id, a.created_at from public.audit_logs a
     where a.action = 'ticket_updated' and a.created_at >= p_from and a.created_at < p_to
       and a.after_data ->> 'status' in ('resolved', 'closed') and coalesce(a.before_data ->> 'status', '') not in ('resolved', 'closed')
  ),
  first_reply as (
    select distinct on (m.ticket_id) m.ticket_id, m.author_id, m.created_at
      from public.support_ticket_messages m
     where m.from_staff and not m.internal and m.author_id is not null
     order by m.ticket_id, m.id
  )
  select s.id, private.member_of(s.id), s.full_name, s.role_name, s.is_active,
    (select count(*) from resolved x where x.actor_id = s.id),
    (select round(avg(extract(epoch from (x.created_at - t.created_at)) / 3600)::numeric, 1)
       from resolved x join public.support_tickets t on t.id::text = x.entity_id where x.actor_id = s.id),
    (select round(avg(extract(epoch from (f.created_at - t.created_at)) / 3600)::numeric, 1)
       from first_reply f join public.support_tickets t on t.id = f.ticket_id
      where f.author_id = s.id and f.created_at >= p_from and f.created_at < p_to),
    (select count(*) from public.support_ticket_messages m where m.author_id = s.id and m.from_staff and not m.internal and m.created_at >= p_from and m.created_at < p_to),
    (select round(avg(t.rating)::numeric, 1) from public.support_tickets t
      where t.assigned_to = s.id and t.rating is not null and t.rated_at >= p_from and t.rated_at < p_to),
    (select count(*) from public.order_status_history h where h.changed_by = s.id and h.to_status = 'completed' and h.created_at >= p_from and h.created_at < p_to),
    (select count(*) from public.order_status_history h where h.changed_by = s.id and h.from_status is not null
        and h.to_status in ('processing', 'ready_for_pickup', 'out_for_delivery', 'completed') and h.created_at >= p_from and h.created_at < p_to),
    (select count(*) from public.payment_submissions ps where ps.reviewed_by = s.id and ps.status = 'verified' and ps.reviewed_at >= p_from and ps.reviewed_at < p_to),
    (select count(*) from public.payment_submissions ps where ps.reviewed_by = s.id and ps.status = 'rejected' and ps.reviewed_at >= p_from and ps.reviewed_at < p_to),
    (select round(avg(extract(epoch from (ps.reviewed_at - ps.submitted_at)) / 60)::numeric, 0) from public.payment_submissions ps
      where ps.reviewed_by = s.id and ps.status in ('verified', 'rejected') and ps.reviewed_at >= p_from and ps.reviewed_at < p_to),
    (select count(*) from public.wallet_topups w where w.reviewed_by = s.id and w.status = 'verified' and w.reviewed_at >= p_from and w.reviewed_at < p_to),
    (select count(*) from public.wallet_topups w where w.reviewed_by = s.id and w.status = 'rejected' and w.reviewed_at >= p_from and w.reviewed_at < p_to),
    (select count(*) from public.printing_job_history h where h.changed_by = s.id and h.to_status = 'completed' and h.created_at >= p_from and h.created_at < p_to),
    (select count(*) from public.order_status_history h join public.orders o on o.id = h.order_id
      where h.changed_by = s.id and h.from_status is null and o.channel = 'in_store' and o.status <> 'cancelled' and h.created_at >= p_from and h.created_at < p_to),
    (select coalesce(sum(o.total_etb), 0) from public.order_status_history h join public.orders o on o.id = h.order_id
      where h.changed_by = s.id and h.from_status is null and o.channel = 'in_store' and o.status <> 'cancelled' and h.created_at >= p_from and h.created_at < p_to)
  from staff s
  order by s.full_name;
end;
$$;
revoke all on function public.admin_staff_kpis(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_staff_kpis(timestamptz, timestamptz) to authenticated;

-- KPI exports are recorded like the others.
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
  elsif p_kind = 'all' then perform private.require_permission('data.manage');
  elsif p_kind = 'notifications' then perform private.require_permission('settings.manage');
  elsif p_kind = 'users' then perform private.require_permission('security.manage');
  elsif p_kind = 'support' then perform private.require_permission('support.view');
  elsif p_kind = 'customers' then perform private.require_permission('customers.view');
  elsif p_kind = 'products' then perform private.require_permission('products.view');
  elsif p_kind = 'wallet' then perform private.require_permission('wallet.manage');
  elsif p_kind = 'printing' then perform private.require_permission('printing.view');
  elsif p_kind = 'kpi' then perform private.require_permission('kpi.view');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;
