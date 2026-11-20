-- =============================================================================
-- 0028 SAVED CUSTOMER DETAILS + ACTIVITY LOG EXPORT / CLEARING
--   * Customers keep a default delivery city and address (prefills checkout,
--     editable in My account). Changes are recorded on the customer timeline.
--   * Activity log: Excel export (audit.view) and clearing of entries older
--     than 30 days (audit.manage, Super Admin). Every export and clearing is
--     itself recorded; the clearing records can never be cleared.
-- =============================================================================

alter table public.customer_accounts
  add column default_zone_id uuid references public.delivery_zones(id) on delete set null,
  add column default_address text check (char_length(default_address) between 3 and 300);
grant update (default_zone_id, default_address) on public.customer_accounts to authenticated;

create or replace function private.audit_customer_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.full_name, old.phone, old.default_zone_id, old.default_address)
     is distinct from (new.full_name, new.phone, new.default_zone_id, new.default_address) then
    perform private.audit('profile_updated', 'customer_account', new.id::text,
      jsonb_strip_nulls(jsonb_build_object('full_name', old.full_name, 'phone', old.phone,
        'delivery_city', (select z.name_en from public.delivery_zones z where z.id = old.default_zone_id), 'address', old.default_address)),
      jsonb_strip_nulls(jsonb_build_object('full_name', new.full_name, 'phone', new.phone,
        'delivery_city', (select z.name_en from public.delivery_zones z where z.id = new.default_zone_id), 'address', new.default_address)));
  end if;
  return new;
end;
$$;
drop trigger audit_customer_accounts on public.customer_accounts;
create trigger audit_customer_accounts after update of full_name, phone, default_zone_id, default_address on public.customer_accounts
  for each row execute function private.audit_customer_account_change();

-- ---------------------------------------------------------------------------
-- Activity log tools
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, description)
values ('audit.manage', 'Clear old activity log entries')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select id, 'audit.manage' from public.admin_roles where key = 'super_admin'
on conflict do nothing;

-- Entries for an Excel export (date range, optional area).
create or replace function public.admin_activity_export(p_from timestamptz, p_to timestamptz, p_entity_type text default null)
returns table (
  id bigint, created_at timestamptz, actor_name text, actor_role text, action text, entity_type text, entity_id text,
  entity_label text, before_data jsonb, after_data jsonb, metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  if p_from is null or p_to is null or p_to <= p_from then perform private.app_error('invalid_request'); end if;
  return query
    select a.id, a.created_at, private.actor_name(a.actor_id), a.actor_role, a.action, a.entity_type, a.entity_id,
           case a.entity_type
             when 'order' then (select o.order_number from public.orders o where o.id::text = a.entity_id)
             when 'printing_job' then (select j.job_number from public.printing_jobs j where j.id::text = a.entity_id)
             when 'customer_account' then coalesce((select u.email::text from auth.users u where u.id::text = a.entity_id), a.before_data ->> 'email')
             when 'products' then coalesce(a.after_data ->> 'name_en', a.before_data ->> 'name_en')
             else null
           end,
           a.before_data, a.after_data, a.metadata
      from public.audit_logs a
     where a.created_at >= p_from and a.created_at < p_to
       and (p_entity_type is null or a.entity_type = p_entity_type)
     order by a.id
     limit 50000;
end;
$$;

-- Exports are recorded (who, what, which period). Orders: orders.view_all; activity log: audit.view.
create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'orders' then perform private.require_permission('orders.view_all');
  elsif p_kind = 'activity' then perform private.require_permission('audit.view');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;

-- The log stays append-only, except for the controlled clearing below.
create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.audit_purge', true) = 'on' and old.action <> 'audit_cleared' then
    return old;
  end if;
  raise exception 'audit_logs is append-only';
end;
$$;

-- Clear entries created before p_before (at least 30 days ago). Returns how many were removed.
create or replace function public.admin_clear_audit_logs(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_permission('audit.manage');
  if p_before is null or p_before > now() - interval '30 days' then
    perform private.app_error('invalid_request', 'keep_last_30_days');
  end if;
  perform set_config('app.audit_purge', 'on', true);
  with d as (delete from public.audit_logs where created_at < p_before and action <> 'audit_cleared' returning 1)
  select count(*)::integer into v_count from d;
  perform set_config('app.audit_purge', '', true);
  perform private.audit('audit_cleared', 'audit', null, null, null, jsonb_build_object('before', p_before, 'deleted', v_count));
  return v_count;
end;
$$;

revoke execute on function public.admin_activity_export(timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.admin_clear_audit_logs(timestamptz) from public, anon;
grant execute on function public.admin_activity_export(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_clear_audit_logs(timestamptz) to authenticated;
