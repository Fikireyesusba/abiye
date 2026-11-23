-- 0060: every Telegram alert names the person by User ID only:
--   payload.user_id    = the customer (or account) the alert is about,
--   payload.by_user_id = the staff member who did it (admin actions, decisions).
-- Worked out when the message is queued, from the order / printing job / top-up / ticket / account.

create or replace function private.telegram_enrich()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb := coalesce(new.payload, '{}'::jsonb);
  v_uid uuid;
  v_by uuid;
  v_src bigint;
  v_audit public.audit_logs;
  v_uuid_re constant text := '^[0-9a-fA-F-]{36}$';
begin
  if new.channel <> 'telegram' then return new; end if;
  if coalesce(p ->> 'user_id', '') !~ '^[1-9][0-9]{5}$' then
    if coalesce(p ->> 'order_id', '') ~ v_uuid_re then
      select user_id into v_uid from public.orders where id = (p ->> 'order_id')::uuid;
    end if;
    if v_uid is null and coalesce(p ->> 'job_id', '') ~ v_uuid_re then
      select coalesce(j.user_id, o.user_id) into v_uid from public.printing_jobs j left join public.orders o on o.id = j.order_id
       where j.id = (p ->> 'job_id')::uuid;
    end if;
    if v_uid is null and coalesce(p ->> 'topup_id', '') ~ v_uuid_re then
      select user_id into v_uid from public.wallet_topups where id = (p ->> 'topup_id')::uuid;
    end if;
    if v_uid is null and coalesce(p ->> 'number', '') like 'TU-%' then
      select user_id into v_uid from public.wallet_topups where topup_number = p ->> 'number';
    end if;
    if v_uid is null and coalesce(p ->> 'ticket_id', '') ~ v_uuid_re then
      select user_id into v_uid from public.support_tickets where id = (p ->> 'ticket_id')::uuid;
    end if;
    if v_uid is null and new.event_type = 'admin_action' and new.dedupe_key like 'feed:admin:%' then
      select * into v_audit from public.audit_logs where id = nullif(split_part(new.dedupe_key, ':', 3), '')::bigint;
      v_uid := private.subject_user(v_audit.entity_type, v_audit.entity_id);
      v_by := v_audit.actor_id;
    end if;
    if v_uid is null and new.event_type = 'notification_copy' and new.dedupe_key like 'feed:copy:%' then
      v_src := nullif(split_part(new.dedupe_key, ':', 3), '')::bigint;
      select recipient_user_id into v_uid from public.notifications_outbox where id = v_src;
    end if;
    if v_uid is null and new.event_type in ('security_event', 'security_alert') and p ? 'email' then
      select id into v_uid from auth.users where lower(email) = lower(p ->> 'email');
    end if;
    if v_uid is not null then p := p || jsonb_build_object('user_id', private.member_of(v_uid)); end if;
  end if;
  if v_by is null and coalesce(p ->> 'decided_by', p ->> 'by', '') <> '' then
    select id into v_by from public.profiles where full_name = coalesce(p ->> 'decided_by', p ->> 'by') limit 1;
  end if;
  if v_by is not null and not p ? 'by_user_id' then p := p || jsonb_build_object('by_user_id', private.member_of(v_by)); end if;
  new.payload := p;
  return new;
end;
$$;
revoke all on function private.telegram_enrich() from public, anon, authenticated;

drop trigger if exists notifications_outbox_telegram_enrich on public.notifications_outbox;
create trigger notifications_outbox_telegram_enrich before insert on public.notifications_outbox
  for each row execute function private.telegram_enrich();
