-- 0061: Excel downloads are for the Super Admin only (every export is recorded through
-- admin_log_export, which now refuses everyone else); wallet balances can be searched by User ID.

create or replace function public.admin_wallet_balances(p_search text default null, p_limit integer default 100)
returns table (user_id uuid, email text, full_name text, balance_etb numeric, last_activity timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('wallet.manage');
  return query
    select c.id, u.email::text, c.full_name, c.wallet_balance_etb,
           (select max(l.created_at) from public.wallet_ledger l where l.user_id = c.id)
      from public.customer_accounts c join auth.users u on u.id = c.id
     where (c.wallet_balance_etb > 0 or exists (select 1 from public.wallet_ledger l where l.user_id = c.id))
       and (v_q is null or c.member_id = v_q or u.email ilike '%' || v_q || '%' or c.full_name ilike '%' || v_q || '%')
     order by 5 desc nulls last
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Excel downloads are for the Super Admin only.
  if coalesce(private.current_role_key(), '') <> 'super_admin' or not private.mfa_verified() then perform private.app_error('forbidden'); end if;
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
