-- =============================================================================
-- 0079 GRAFANA TOKEN WITHOUT A VERCEL VARIABLE
--   The Super Admin creates the metrics token in Admin → Notifications → Telegram groups & alerts → Grafana.
--   Only its SHA-256 fingerprint is stored (settings key "monitoring"); the token is shown once.
--   metrics_snapshot_for(token) returns the totals when the token matches — callable from the website without the
--   secret key (the website rate-limits by address first). The METRICS_TOKEN variable still works if set.
-- =============================================================================

create or replace function public.admin_set_metrics_token(p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  if coalesce(private.current_role_key(), '') <> 'super_admin' or not private.mfa_verified() then perform private.app_error('forbidden'); end if;
  if p_hash is not null and p_hash !~ '^[0-9a-f]{64}$' then perform private.app_error('invalid_request'); end if;
  insert into public.website_settings (key, value, is_public) values ('monitoring', '{}'::jsonb, false) on conflict (key) do nothing;
  update public.website_settings
     set value = case when p_hash is null then value - 'metrics_token_hash' - 'metrics_token_at'
                      else value || jsonb_build_object('metrics_token_hash', p_hash, 'metrics_token_at', now()) end
   where key = 'monitoring';
  perform private.audit(case when p_hash is null then 'metrics_token_removed' else 'metrics_token_created' end, 'website_settings', 'monitoring');
end;
$$;
revoke all on function public.admin_set_metrics_token(text) from public, anon;
grant execute on function public.admin_set_metrics_token(text) to authenticated;

create or replace function public.metrics_snapshot_for(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text := private.setting('monitoring') ->> 'metrics_token_hash';
begin
  if v_hash is null or p_token is null or char_length(p_token) not between 32 and 200
     or encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> v_hash then
    perform private.app_error('forbidden');
  end if;
  return public.metrics_snapshot();
end;
$$;
revoke all on function public.metrics_snapshot_for(text) from public;
grant execute on function public.metrics_snapshot_for(text) to anon, authenticated, service_role;
