-- =============================================================================
-- 0022 CUSTOMER EMAIL NOTIFICATIONS
--   Same transactional outbox as the staff Telegram alerts (written in the
--   same transaction as the change, retried with backoff), channel 'email'.
--   The recipient is the order's / job's customer account (user id); the
--   address is looked up only when sending, never stored in the outbox.
--   Events: order placed (how to pay), payment confirmed, payment rejected,
--   ready for pickup, out for delivery, completed, cancelled, expired;
--   printing quote ready, printing ready.
-- =============================================================================

alter table public.notifications_outbox drop constraint notifications_outbox_channel_check;
alter table public.notifications_outbox add constraint notifications_outbox_channel_check check (channel in ('telegram', 'email'));
alter table public.notifications_outbox add column recipient_user_id uuid references auth.users(id) on delete cascade;
alter table public.notifications_outbox add constraint notifications_outbox_email_recipient
  check (channel <> 'email' or recipient_user_id is not null);
create index notifications_outbox_channel_due_idx on public.notifications_outbox(channel, next_attempt_at)
  where status in ('pending', 'failed');

create or replace function public.claim_outbox(p_channel text, p_limit integer default 10)
returns setof public.notifications_outbox
language sql
security definer
set search_path = ''
as $$
  update public.notifications_outbox o
     set status = 'processing',
         attempts = o.attempts + 1,
         locked_until = now() + interval '2 minutes'
   where o.id in (
     select id from public.notifications_outbox
      where channel = p_channel
        and ((status in ('pending', 'failed') and next_attempt_at <= now())
          or (status = 'processing' and locked_until < now()))   -- crashed worker
      order by id
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning o.*;
$$;

-- The Telegram worker only takes Telegram rows from now on.
create or replace function public.claim_notifications(p_limit integer default 10)
returns setof public.notifications_outbox
language sql
security definer
set search_path = ''
as $$
  select * from public.claim_outbox('telegram', p_limit)
$$;

create or replace function private.enqueue_customer_email(p_event text, p_dedupe text, p_user uuid, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, recipient_user_id, max_attempts)
  select 'email', p_event, p_dedupe, p_payload, p_user, 6
   where p_user is not null
  on conflict (dedupe_key) do nothing;
$$;

-- Orders: placed + every customer-relevant status change.
create or replace function private.email_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_note text;
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_event := 'order_placed';
  elsif new.status is distinct from old.status then
    v_event := case new.status
      when 'confirmed' then 'order_confirmed'
      when 'payment_rejected' then 'order_payment_rejected'
      when 'ready_for_pickup' then 'order_ready_for_pickup'
      when 'out_for_delivery' then 'order_out_for_delivery'
      when 'completed' then 'order_completed'
      when 'cancelled' then 'order_cancelled'
      when 'expired' then 'order_expired'
    end;
  end if;
  if v_event is null then return new; end if;
  if v_event = 'order_payment_rejected' then
    select s.review_note into v_note from public.payment_submissions s
     where s.order_id = new.id and s.status = 'rejected' order by s.reviewed_at desc limit 1;
  end if;
  perform private.enqueue_customer_email(
    'customer_' || v_event,
    'email:' || v_event || ':' || new.id || ':' || (select count(*) from public.order_status_history h where h.order_id = new.id),
    new.user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_id', new.id, 'order_number', new.order_number, 'total_etb', new.total_etb,
      'fulfillment', new.fulfillment_method, 'locale', new.locale, 'note', v_note,
      'payment_due_at', case when v_event = 'order_placed' then new.payment_due_at end,
      'bank', case when v_event = 'order_placed' then new.bank_snapshot end)));
  return new;
end;
$$;
create trigger email_order_placed after insert on public.orders
  for each row execute function private.email_order_event();
create trigger email_order_status after update of status on public.orders
  for each row execute function private.email_order_event();

-- Printing jobs: quote ready, ready to collect.
create or replace function private.email_printing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if new.user_id is null or new.status is not distinct from old.status then return new; end if;
  v_event := case
    when new.status = 'awaiting_payment' and old.status = 'awaiting_quote' then 'printing_quote_ready'
    when new.status = 'ready' then 'printing_ready'
  end;
  if v_event is null then return new; end if;
  perform private.enqueue_customer_email(
    'customer_' || v_event, 'email:' || v_event || ':' || new.id, new.user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'job_id', new.id, 'job_number', new.job_number, 'total_etb', new.total_etb,
      'fulfillment', new.fulfillment_method)));
  return new;
end;
$$;
create trigger email_printing_status after update of status on public.printing_jobs
  for each row execute function private.email_printing_event();

revoke execute on function public.claim_outbox(text, integer) from public, anon, authenticated;
grant execute on function public.claim_outbox(text, integer) to service_role;
