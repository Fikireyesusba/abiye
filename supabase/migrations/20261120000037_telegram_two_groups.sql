-- =============================================================================
-- 0037 TWO TELEGRAM GROUPS + FULL ORDER / PRINTING PROGRESS
--   * Orders & payments group (TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID): every step of
--     an order and printing job until it is collected, payments, top-ups, stock, copies of
--     customer messages.
--   * Security group (TELEGRAM_SECURITY_BOT_TOKEN / TELEGRAM_SECURITY_CHAT_ID): security
--     events, 🚨 alerts, admin sign-ins and admin actions.
--   The sender claims each group's messages separately (claim_telegram).
-- =============================================================================

-- Which messages belong to the security group.
create or replace function private.is_security_message(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_event in ('security_event', 'security_alert', 'admin_action', 'security_test') $$;

-- Worker (service_role): claim due Telegram rows of one group (SKIP LOCKED).
create or replace function public.claim_telegram(p_security boolean, p_limit integer default 10)
returns setof public.notifications_outbox
language sql
security definer
set search_path = ''
as $$
  update public.notifications_outbox o
     set status = 'processing', attempts = o.attempts + 1, locked_until = now() + interval '2 minutes'
   where o.id in (
     select id from public.notifications_outbox
      where channel = 'telegram'
        and private.is_security_message(event_type) = coalesce(p_security, false)
        and ((status in ('pending', 'failed') and next_attempt_at <= now())
          or (status = 'processing' and locked_until < now()))
      order by id
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked)
  returning o.*;
$$;
revoke all on function public.claim_telegram(boolean, integer) from public, anon, authenticated;
grant execute on function public.claim_telegram(boolean, integer) to service_role;

-- Orders: "order placed (awaiting payment)" — checked at COMMIT, so balance-paid orders
-- (already confirmed by then) are not announced twice.
create or replace function private.telegram_order_placed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = new.id;
  if not found or o.status <> 'awaiting_payment' then return null; end if;
  perform private.enqueue_notification('order_placed', 'order_placed:' || o.id, jsonb_build_object(
    'order_id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
    'total_etb', o.total_etb, 'fulfillment_method', o.fulfillment_method, 'city', o.city, 'address_line', o.address_line,
    'payment_due_at', o.payment_due_at,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name_en, 'quantity', i.quantity) order by i.id), '[]'::jsonb)
                from public.order_items i where i.order_id = o.id)));
  return null;
end;
$$;
drop trigger if exists orders_telegram_placed on public.orders;
create constraint trigger orders_telegram_placed after insert on public.orders
  deferrable initially deferred
  for each row execute function private.telegram_order_placed();

-- Orders: every later step until collection (steps already announced elsewhere are skipped:
-- receipt uploaded, payment verified / rejected, cancelled, paid with balance).
create or replace function private.telegram_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status
     or new.status::text not in ('processing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'expired') then
    return null;
  end if;
  perform private.enqueue_notification('order_status', 'order_status:' || new.id || ':' || new.status, jsonb_build_object(
    'order_id', new.id, 'order_number', new.order_number, 'from', old.status, 'to', new.status,
    'by', private.actor_name((select auth.uid())), 'customer_name', new.customer_name, 'customer_phone', new.customer_phone,
    'total_etb', new.total_etb, 'fulfillment_method', new.fulfillment_method, 'city', new.city, 'address_line', new.address_line,
    'note', nullif(current_setting('app.status_note', true), '')));
  return null;
end;
$$;
drop trigger if exists orders_telegram_status on public.orders;
create trigger orders_telegram_status after update of status on public.orders
  for each row execute function private.telegram_order_status();

-- Printing jobs: quote, printing, ready, collected, cancelled.
create or replace function private.telegram_printing_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status
     or new.status::text not in ('awaiting_payment', 'printing', 'ready', 'completed', 'cancelled') then
    return null;
  end if;
  perform private.enqueue_notification('printing_status', 'printing_status:' || new.id || ':' || new.status, jsonb_build_object(
    'job_id', new.id, 'job_number', new.job_number, 'from', old.status, 'to', new.status,
    'by', private.actor_name((select auth.uid())), 'customer_name', new.customer_name, 'customer_phone', new.customer_phone,
    'total_etb', new.total_etb, 'page_count', new.page_count, 'copies', new.copies, 'fulfillment_method', new.fulfillment_method,
    'note', nullif(current_setting('app.status_note', true), '')));
  return null;
end;
$$;
drop trigger if exists printing_jobs_telegram_status on public.printing_jobs;
create trigger printing_jobs_telegram_status after update of status on public.printing_jobs
  for each row execute function private.telegram_printing_status();

-- "Send test message" for the security group (Super Admin).
create or replace function public.admin_queue_security_test()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  perform private.enqueue_notification('security_test', 'security_test:' || gen_random_uuid(),
    jsonb_build_object('requested_by', private.actor_name(auth.uid()), 'requested_at', now()));
end;
$$;
revoke all on function public.admin_queue_security_test() from public, anon;
grant execute on function public.admin_queue_security_test() to authenticated;

-- Notifications list: also the channel (to group the page by category). Signature change → drop first.
drop function if exists public.admin_notifications(integer);
create function public.admin_notifications(p_limit integer default 50)
returns table (
  id bigint, channel text, event_type text, status public.notification_status, attempts integer, max_attempts integer,
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
    select o.id, o.channel, o.event_type, o.status, o.attempts, o.max_attempts, o.last_error, o.created_at, o.sent_at, o.next_attempt_at,
           coalesce(o.payload ->> 'order_number', o.payload ->> 'job_number', o.payload ->> 'number', o.payload ->> 'topup_number',
                    o.payload ->> 'email', o.payload ->> 'name', o.payload ->> 'label')
    from public.notifications_outbox o
    order by o.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 1000));
end;
$$;
revoke all on function public.admin_notifications(integer) from public, anon;
grant execute on function public.admin_notifications(integer) to authenticated;
