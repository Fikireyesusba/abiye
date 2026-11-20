-- Excel export of reviewed (verified / rejected) payments: order bank transfers and wallet top-ups.
-- Read-only; recorded in the activity log by the app via admin_log_export('payments').

-- Order payment receipts reviewed in a period (by decision time). Needs payments.view.
create or replace function public.admin_payments_export(p_from timestamptz, p_to timestamptz, p_status text default null)
returns table (
  id uuid, order_number text, order_status text, payment_method text, customer_name text, customer_phone text, customer_email text,
  amount_expected_etb numeric, order_total_etb numeric, bank_name text, account_number text, transaction_reference text,
  receipt_original_name text, receipt_sha256 text, submitted_at timestamptz, status text, reviewed_at timestamptz,
  reviewed_by_name text, review_note text, reference_used_elsewhere integer, receipt_used_elsewhere integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('payments.view');
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '367 days' then perform private.app_error('invalid_request'); end if;
  if p_status is not null and p_status not in ('verified', 'rejected') then perform private.app_error('invalid_request'); end if;
  return query
    select s.id, o.order_number, o.status::text, o.payment_method, o.customer_name, o.customer_phone, coalesce(u.email::text, c.email::text),
           s.amount_expected_etb, o.total_etb, o.bank_snapshot ->> 'bank_name', o.bank_snapshot ->> 'account_number', s.transaction_reference,
           s.receipt_original_name, s.receipt_sha256, s.submitted_at, s.status::text, s.reviewed_at,
           private.actor_name(s.reviewed_by), s.review_note,
           (select count(distinct x.order_id)::int from public.payment_submissions x
             where s.transaction_reference is not null and lower(x.transaction_reference) = lower(s.transaction_reference) and x.order_id <> s.order_id),
           (select count(distinct x.order_id)::int from public.payment_submissions x
             where x.receipt_sha256 = s.receipt_sha256 and x.order_id <> s.order_id)
      from public.payment_submissions s
      join public.orders o on o.id = s.order_id
      left join public.customers c on c.id = o.customer_id
      left join auth.users u on u.id = o.user_id
     where s.status::text in ('verified', 'rejected')
       and (p_status is null or s.status::text = p_status)
       and s.reviewed_at >= p_from and s.reviewed_at < p_to
     order by s.reviewed_at, s.id
     limit 50000;
end;
$$;

-- Wallet top-ups reviewed in a period. Needs wallet.manage (Manager / Super Admin).
create or replace function public.admin_topups_export(p_from timestamptz, p_to timestamptz, p_status text default null)
returns table (
  id uuid, topup_number text, customer_name text, customer_email text, amount_etb numeric, bank_name text, account_number text,
  transaction_reference text, created_at timestamptz, status text, reviewed_at timestamptz, reviewed_by_name text, review_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('wallet.manage');
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '367 days' then perform private.app_error('invalid_request'); end if;
  if p_status is not null and p_status not in ('verified', 'rejected') then perform private.app_error('invalid_request'); end if;
  return query
    select t.id, t.topup_number, a.full_name, u.email::text, t.amount_etb, t.bank_snapshot ->> 'bank_name', t.bank_snapshot ->> 'account_number',
           t.transaction_reference, t.created_at, t.status, t.reviewed_at, private.actor_name(t.reviewed_by), t.review_note
      from public.wallet_topups t
      left join public.customer_accounts a on a.id = t.user_id
      left join auth.users u on u.id = t.user_id
     where t.status in ('verified', 'rejected')
       and (p_status is null or t.status = p_status)
       and t.reviewed_at >= p_from and t.reviewed_at < p_to
     order by t.reviewed_at, t.id
     limit 50000;
end;
$$;

revoke all on function public.admin_payments_export(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.admin_topups_export(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_payments_export(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_topups_export(timestamptz, timestamptz, text) to authenticated;

-- Exports are recorded. Orders: orders.view_all; activity log: audit.view; payments: payments.view.
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
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;
