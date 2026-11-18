-- =============================================================================
-- 0015 NOTIFICATION ADMIN
-- notifications_outbox stays service_role-only at the table level; admins with
-- settings.manage get a read-only view of recent rows, can re-queue failed or
-- dead messages, and can queue a test message.
-- =============================================================================

create or replace function public.admin_notifications(p_limit integer default 50)
returns table (
  id bigint, event_type text, status public.notification_status, attempts integer, max_attempts integer,
  last_error text, created_at timestamptz, sent_at timestamptz, next_attempt_at timestamptz, reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return query
    select o.id, o.event_type, o.status, o.attempts, o.max_attempts, o.last_error, o.created_at, o.sent_at, o.next_attempt_at,
           coalesce(o.payload ->> 'order_number', o.payload ->> 'job_number', o.payload ->> 'label')
    from public.notifications_outbox o
    order by o.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.admin_retry_notification(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  update public.notifications_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(), locked_until = null, last_error = null
   where id = p_id and status in ('failed', 'dead');
  if not found then perform private.app_error('invalid_transition', 'only failed messages can be retried'); end if;
  perform private.audit('notification_retry', 'notification', p_id::text);
end;
$$;

create or replace function public.admin_queue_test_notification()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  perform private.enqueue_notification('test_message', 'test:' || gen_random_uuid(),
    jsonb_build_object('label', 'Test message', 'requested_by_role', private.current_role_key(), 'requested_at', now()));
end;
$$;

revoke execute on function public.admin_notifications(integer) from public, anon;
revoke execute on function public.admin_retry_notification(bigint) from public, anon;
revoke execute on function public.admin_queue_test_notification() from public, anon;
grant execute on function public.admin_notifications(integer) to authenticated;
grant execute on function public.admin_retry_notification(bigint) to authenticated;
grant execute on function public.admin_queue_test_notification() to authenticated;
