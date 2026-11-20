-- =============================================================================
-- 0036 TELEGRAM ACTIVITY FEED
--   Staff Telegram also receives, each with an event name, a service name and details:
--     * security   – every security event (+ a 🚨 alert when an email becomes high-risk)
--     * admin      – sensitive admin actions (blocking, alert clearing, staff / roles / banks /
--                    settings changes, account deactivation / deletion, wallet corrections,
--                    exports, activity clearing, resets, two-step resets)
--     * notifications – a copy of every customer email / phone notification / receipt-archive
--                    email once it was sent (✓) or failed for good (✗)
--   Each part can be switched off (Admin → Notifications). Queued in the same transaction.
-- =============================================================================

-- Switches (private setting; default: all on).
create or replace function private.feed_on(p_part text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((private.setting('telegram_feed') ->> p_part)::boolean, true) $$;

create or replace function public.admin_set_telegram_feed(p_security boolean, p_admin boolean, p_notifications boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := jsonb_build_object('security', coalesce(p_security, true), 'admin', coalesce(p_admin, true), 'notifications', coalesce(p_notifications, true));
begin
  perform private.require_permission('settings.manage');
  insert into public.website_settings (key, value, is_public, updated_by) values ('telegram_feed', v, false, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = false, updated_by = excluded.updated_by;
end;
$$;

create or replace function public.admin_telegram_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return jsonb_build_object('security', private.feed_on('security'), 'admin', private.feed_on('admin'), 'notifications', private.feed_on('notifications'));
end;
$$;

-- Risk score of an email over the last 24 h (same weights as the Security page), ignoring reviewed activity.
create or replace function private.email_risk_24h(p_email text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           count(*) filter (where s.kind in ('admin_login_failed', 'admin_login_not_staff')) * 3
         + count(*) filter (where s.kind = 'admin_mfa_failed') * 4
         + count(*) filter (where s.kind = 'customer_login_failed')
         + count(*) filter (where s.kind in ('login_blocked', 'signup_blocked')) * 2
         + count(*) filter (where s.kind = 'rate_limited') * 2
         + greatest(count(distinct s.ip_hash) - 1, 0) * 2, 0)::int
    from public.security_events s
    left join public.security_reviews r on r.subject_type = 'email' and r.subject = lower(s.email)
   where lower(s.email) = lower(p_email) and s.kind <> 'admin_login_success'
     and s.created_at > now() - interval '24 hours'
     and (r.reviewed_at is null or s.created_at > r.reviewed_at)
$$;

-- (1) Security events. Bursts of the same failure / email / network within 5 minutes become one message with a count
--     (plus at most one follow-up). Successful admin sign-ins are always reported individually.
create or replace function private.feed_security_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_score integer;
begin
  if not private.feed_on('security') then return null; end if;
  if new.kind = 'admin_login_success' then
    v_key := 'feed:sec:' || new.id;   -- every admin sign-in is reported on its own
  else
    v_key := 'feed:sec:' || new.kind || ':' || coalesce(lower(new.email), '-') || ':' || coalesce(new.ip_hash, '-') || ':' || floor(extract(epoch from new.created_at) / 300)::bigint;
    -- First message already sent: further repeats in the same 5 minutes collect in one follow-up message.
    if exists (select 1 from public.notifications_outbox where dedupe_key = v_key and status <> 'pending') then
      v_key := v_key || ':more';
    end if;
  end if;
  insert into public.notifications_outbox (channel, event_type, dedupe_key, payload)
  values ('telegram', 'security_event', v_key, jsonb_build_object(
    'kind', new.kind, 'email', new.email, 'account', private.actor_name(new.user_id),
    'is_staff', exists (select 1 from public.profiles p where p.id = new.user_id),
    'network', left(new.ip_hash, 10), 'device', left(new.user_agent, 160), 'details', new.metadata,
    'at', new.created_at, 'repeats', 1))
  on conflict (dedupe_key) do update
     set payload = jsonb_set(public.notifications_outbox.payload, '{repeats}',
                             to_jsonb(coalesce((public.notifications_outbox.payload ->> 'repeats')::int, 1) + 1))
   where public.notifications_outbox.status = 'pending';

  -- 🚨 once per email per day when it becomes high-risk (not blocked, not reviewed).
  if new.email is not null and new.kind <> 'admin_login_success' and not private.email_is_blocked(new.email) then
    v_score := private.email_risk_24h(new.email);
    if v_score >= 6 then
      insert into public.notifications_outbox (channel, event_type, dedupe_key, payload)
      values ('telegram', 'security_alert', 'feed:alert:' || lower(new.email) || ':' || (now() at time zone 'Africa/Addis_Ababa')::date,
              jsonb_build_object('email', new.email, 'score', v_score, 'last_kind', new.kind, 'network', left(new.ip_hash, 10),
                                 'has_account', exists (select 1 from auth.users u where lower(u.email) = lower(new.email)),
                                 'is_staff', exists (select 1 from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(new.email)),
                                 'at', new.created_at))
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists security_events_feed on public.security_events;
create trigger security_events_feed after insert on public.security_events
  for each row execute function private.feed_security_event();

-- (2) Sensitive admin actions from the activity log.
create or replace function private.feed_admin_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.feed_on('admin') then return null; end if;
  if not (new.action in ('email_blocked', 'email_unblocked', 'security_reviewed', 'data_reset', 'audit_cleared', 'mfa_reset',
                         'wallet_adjusted', 'customer_deactivated', 'customer_reactivated', 'customer_deleted', 'password_reset_sent',
                         'receipt_archive_set', 'receipt_archive_backfill')
          or new.action like 'export\_%'
          or new.entity_type in ('profiles', 'role_permissions', 'bank_accounts', 'website_settings')) then
    return null;
  end if;
  perform private.enqueue_notification('admin_action', 'feed:admin:' || new.id, jsonb_build_object(
    'action', new.action, 'entity_type', new.entity_type, 'entity_id', new.entity_id,
    'actor', coalesce(private.actor_name(new.actor_id), 'System'), 'role', new.actor_role,
    'before', left(coalesce(new.before_data::text, ''), 1500), 'after', left(coalesce(new.after_data::text, ''), 1500),
    'metadata', new.metadata, 'at', new.created_at));
  return null;
end;
$$;
drop trigger if exists audit_logs_feed on public.audit_logs;
create trigger audit_logs_feed after insert on public.audit_logs
  for each row execute function private.feed_admin_action();

-- (3) Copies of customer notifications once they are sent or failed for good.
create or replace function private.feed_notification_copy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'telegram' or new.status not in ('sent', 'dead') or old.status = new.status then return null; end if;
  if not private.feed_on('notifications') then return null; end if;
  perform private.enqueue_notification('notification_copy', 'feed:copy:' || new.id || ':' || new.status, jsonb_build_object(
    'channel', new.channel, 'event', new.event_type, 'status', new.status, 'attempts', new.attempts,
    'error', left(new.last_error, 300),
    'to', case when new.channel = 'archive' then private.setting('receipt_archive') ->> 'email'
               else (select u.email::text from auth.users u where u.id = new.recipient_user_id) end,
    'order_number', new.payload ->> 'order_number', 'job_number', new.payload ->> 'job_number',
    'number', coalesce(new.payload ->> 'number', new.payload ->> 'topup_number'), 'product', new.payload ->> 'name',
    'amount_etb', coalesce(new.payload ->> 'total_etb', new.payload ->> 'amount_etb'), 'note', left(new.payload ->> 'note', 200),
    'at', coalesce(new.sent_at, now())));
  return null;
end;
$$;
drop trigger if exists notifications_outbox_feed on public.notifications_outbox;
create trigger notifications_outbox_feed after update of status on public.notifications_outbox
  for each row execute function private.feed_notification_copy();

-- Maintenance (service_role): feed messages never sent within 2 days (e.g. Telegram not set up) are dropped.
create or replace function public.purge_stale_telegram_feed()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.notifications_outbox
   where channel = 'telegram' and status in ('pending', 'failed', 'dead')
     and event_type in ('security_event', 'security_alert', 'admin_action', 'notification_copy')
     and created_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.admin_set_telegram_feed(boolean, boolean, boolean) from public, anon;
revoke all on function public.admin_telegram_feed() from public, anon;
revoke all on function public.purge_stale_telegram_feed() from public, anon, authenticated;
revoke all on function private.email_risk_24h(text) from public;
revoke all on function private.feed_on(text) from public;
grant execute on function public.admin_set_telegram_feed(boolean, boolean, boolean) to authenticated;
grant execute on function public.admin_telegram_feed() to authenticated;
grant execute on function public.purge_stale_telegram_feed() to service_role;
