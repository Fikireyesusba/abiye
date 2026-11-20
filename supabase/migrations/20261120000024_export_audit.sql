-- =============================================================================
-- 0024 EXPORT AUDIT
--   Order exports contain customer names, phones and addresses: every export
--   is recorded in the audit log (who, when, which period, how many rows).
-- =============================================================================

create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('orders.view_all');
  if p_kind not in ('orders') then perform private.app_error('invalid_request'); end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;
revoke execute on function public.admin_log_export(text, jsonb) from public, anon;
grant execute on function public.admin_log_export(text, jsonb) to authenticated;
