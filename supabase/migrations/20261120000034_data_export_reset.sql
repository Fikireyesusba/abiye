-- =============================================================================
-- 0034 EXPORT EVERYTHING / RESET TEST DATA (Super Admin only: data.manage)
--   * admin_data_export(area, offset, limit): every business area as JSON rows for an
--     Excel export. Secrets (access/tracking token hashes, idempotency keys, push keys)
--     are never exported.
--   * admin_reset_test_data(confirm): removes orders, payments, printing jobs, wallet
--     history, reviews, customer accounts and test logs; KEEPS products, categories,
--     settings, bank accounts, delivery zones, prices, promotions, banners and staff.
--     Refused unless the confirmation phrase matches AND the same admin exported
--     everything in the last 30 minutes. The reset is recorded permanently.
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('data.manage', 'Export all data and reset test data')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select id, 'data.manage' from public.admin_roles where key = 'super_admin'
on conflict do nothing;

create or replace function public.admin_data_export_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'orders', 'order_items', 'payments', 'order_history', 'order_notes', 'printing_jobs', 'printing_files',
    'customer_accounts', 'customers', 'addresses', 'wallet_topups', 'wallet_ledger', 'reviews', 'stock_requests',
    'products', 'product_images', 'categories', 'inventory', 'promotions', 'promotion_customers',
    'delivery_zones', 'bank_accounts', 'printing_prices', 'banners', 'settings', 'staff', 'activity_log',
    'security_events', 'blocked_emails']
$$;

create or replace function public.admin_data_export(p_area text, p_offset integer default 0, p_limit integer default 1000)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1000), 1000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  perform private.require_permission('data.manage');
  case p_area
    when 'orders' then return query select to_jsonb(t) - array['access_token_hash', 'tracking_code_hash', 'idempotency_key'] from public.orders t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'order_items' then return query select to_jsonb(t) from public.order_items t order by t.order_id, t.id offset v_offset limit v_limit;
    when 'payments' then return query select to_jsonb(t) from public.payment_submissions t order by t.submitted_at, t.id offset v_offset limit v_limit;
    when 'order_history' then return query select to_jsonb(t) from public.order_status_history t order by t.id offset v_offset limit v_limit;
    when 'order_notes' then return query select to_jsonb(t) from public.order_notes t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'printing_jobs' then return query select to_jsonb(t) - array['access_token_hash'] from public.printing_jobs t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'printing_files' then return query select to_jsonb(t) from public.printing_files t order by t.job_id, t.id offset v_offset limit v_limit;
    when 'customer_accounts' then return query
      select to_jsonb(a) || jsonb_build_object('email', u.email, 'email_confirmed_at', u.email_confirmed_at, 'last_sign_in_at', u.last_sign_in_at, 'banned_until', u.banned_until)
        from public.customer_accounts a left join auth.users u on u.id = a.id order by a.created_at, a.id offset v_offset limit v_limit;
    when 'customers' then return query select to_jsonb(t) from public.customers t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'addresses' then return query select to_jsonb(t) from public.addresses t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'wallet_topups' then return query select to_jsonb(t) from public.wallet_topups t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'wallet_ledger' then return query select to_jsonb(t) from public.wallet_ledger t order by t.id offset v_offset limit v_limit;
    when 'reviews' then return query select to_jsonb(t) from public.product_reviews t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'stock_requests' then return query select to_jsonb(t) from public.stock_alerts t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'products' then return query select to_jsonb(t) - array['search_vector'] from public.products t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'product_images' then return query select to_jsonb(t) from public.product_images t order by t.product_id, t.sort_order, t.id offset v_offset limit v_limit;
    when 'categories' then return query select to_jsonb(t) from public.categories t order by t.department, t.sort_order, t.id offset v_offset limit v_limit;
    when 'inventory' then return query select to_jsonb(t) from public.inventory_movements t order by t.id offset v_offset limit v_limit;
    when 'promotions' then return query select to_jsonb(t) from public.promotions t order by t.created_at, t.id offset v_offset limit v_limit;
    when 'promotion_customers' then return query select to_jsonb(t) from public.promotion_customers t order by t.created_at offset v_offset limit v_limit;
    when 'delivery_zones' then return query select to_jsonb(t) from public.delivery_zones t order by t.id offset v_offset limit v_limit;
    when 'bank_accounts' then return query select to_jsonb(t) from public.bank_accounts t order by t.id offset v_offset limit v_limit;
    when 'printing_prices' then return query select to_jsonb(t) from public.printing_price_rules t order by t.id offset v_offset limit v_limit;
    when 'banners' then return query select to_jsonb(t) from public.homepage_banners t order by t.id offset v_offset limit v_limit;
    when 'settings' then return query select to_jsonb(t) from public.website_settings t order by t.key offset v_offset limit v_limit;
    when 'staff' then return query
      select to_jsonb(p) || jsonb_build_object('email', u.email, 'role', r.key)
        from public.profiles p left join auth.users u on u.id = p.id left join public.admin_roles r on r.id = p.role_id
       order by p.created_at, p.id offset v_offset limit v_limit;
    when 'activity_log' then return query select to_jsonb(t) from public.audit_logs t order by t.id offset v_offset limit v_limit;
    when 'security_events' then return query select to_jsonb(t) from public.security_events t order by t.id offset v_offset limit v_limit;
    when 'blocked_emails' then return query select to_jsonb(t) from public.blocked_emails t order by t.created_at offset v_offset limit v_limit;
    else perform private.app_error('invalid_request', 'area');
  end case;
end;
$$;

-- Exports are recorded ('all' = export everything; the reset requires a recent one).
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
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;

-- The wallet ledger and the activity log stay append-only, except inside the reset below.
create or replace function private.prevent_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.data_reset', true) = 'on' then return old; end if;
  raise exception 'wallet_ledger is append-only';
end;
$$;

create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.audit_purge', true) = 'on' and old.action not in ('audit_cleared', 'data_reset') then
    return old;
  end if;
  raise exception 'audit_logs is append-only';
end;
$$;

-- "RESET <English business name>"
create or replace function public.admin_reset_phrase()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select 'RESET ' || coalesce(nullif(btrim(private.setting('business') -> 'name' ->> 'en'), ''), 'SHOP') $$;

create or replace function public.admin_reset_test_data(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_counts jsonb;
  n_orders int; n_jobs int; n_customers int; n_accounts int; n_topups int; n_reviews int; n_audit int;
begin
  perform private.require_permission('data.manage');
  if p_confirm is distinct from public.admin_reset_phrase() then
    perform private.app_error('invalid_request', 'confirmation');
  end if;
  if not exists (select 1 from public.audit_logs where action = 'export_all' and actor_id = v_uid and created_at > now() - interval '30 minutes') then
    perform private.app_error('invalid_request', 'export_first');
  end if;
  -- One reset at a time.
  perform pg_advisory_xact_lock(hashtext('admin_reset_test_data'));

  select count(*) into n_orders from public.orders;
  select count(*) into n_jobs from public.printing_jobs;
  select count(*) into n_customers from public.customers;
  select count(*) into n_accounts from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
  select count(*) into n_topups from public.wallet_topups;
  select count(*) into n_reviews from public.product_reviews;

  perform set_config('app.data_reset', 'on', true);
  perform set_config('app.audit_purge', 'on', true);

  -- ("where true": Supabase refuses DELETE without WHERE on API calls)
  delete from public.inventory_movements where order_id is not null;   -- stock levels stay as they are now
  delete from public.wallet_ledger where true;
  delete from public.wallet_topups where true;
  delete from public.product_reviews where true;
  delete from public.stock_alerts where true;
  delete from public.customer_carts where true;
  delete from public.push_subscriptions where true;
  delete from public.orders where true;                -- items, payments, history, notes
  delete from public.printing_jobs where true;         -- files, history
  delete from public.customers where true;             -- addresses
  delete from public.notifications_outbox where true;
  delete from public.rate_limits where true;
  delete from public.security_events where true;
  -- Before the accounts: their activity entries would otherwise need an (forbidden) update.
  delete from public.audit_logs where action not in ('audit_cleared', 'data_reset');
  get diagnostics n_audit = row_count;
  -- Customer sign-in accounts (staff are kept).
  delete from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);

  -- New numbering for the real shop.
  alter sequence public.order_number_seq restart with 10001;
  alter sequence public.print_job_number_seq restart with 10001;
  alter sequence public.wallet_topup_number_seq restart with 1001;

  perform set_config('app.data_reset', 'off', true);
  perform set_config('app.audit_purge', 'off', true);

  v_counts := jsonb_build_object('orders', n_orders, 'printing_jobs', n_jobs, 'customers', n_customers, 'customer_accounts', n_accounts,
                                 'wallet_topups', n_topups, 'reviews', n_reviews, 'activity_entries', n_audit, 'reset_at', now());
  perform private.audit('data_reset', 'data', null, null, null, v_counts);
  return v_counts;
end;
$$;

-- Server (service_role), right after a reset: stored receipts / documents no longer referenced.
create or replace function public.reset_storage_leftovers(p_before timestamptz, p_limit integer default 1000)
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.created_at < p_before
     and ((o.bucket_id = 'payment-receipts'
            and not exists (select 1 from public.payment_submissions s where s.receipt_path = o.name)
            and not exists (select 1 from public.wallet_topups t where t.receipt_path = o.name))
       or (o.bucket_id = 'printing-files'
            and not exists (select 1 from public.printing_files f where f.storage_path = o.name)))
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 1000), 1000))
$$;

revoke all on function public.admin_data_export(text, integer, integer) from public, anon;
revoke all on function public.admin_reset_test_data(text) from public, anon;
revoke all on function public.admin_reset_phrase() from public, anon;
revoke all on function public.reset_storage_leftovers(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.admin_data_export(text, integer, integer) to authenticated;
grant execute on function public.admin_data_export_areas() to authenticated;
grant execute on function public.admin_reset_test_data(text) to authenticated;
grant execute on function public.admin_reset_phrase() to authenticated;
grant execute on function public.reset_storage_leftovers(timestamptz, integer) to service_role;
