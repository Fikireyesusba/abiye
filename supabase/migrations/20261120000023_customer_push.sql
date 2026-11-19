-- =============================================================================
-- 0023 CUSTOMER PHONE NOTIFICATIONS (Web Push)
--   * push_subscriptions: a customer's devices (browser push endpoints).
--     Customers manage only their own rows; the server sends with VAPID keys.
--   * Every customer email event also queues a 'push' outbox row (same
--     transaction, retried independently, sent to all of the customer's devices).
-- =============================================================================

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  -- Only real browser push services (the server POSTs to this URL).
  endpoint     text not null unique check (char_length(endpoint) <= 1000 and endpoint ~
    '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|[a-z0-9-]+\.push\.apple\.com)/'),
  p256dh       text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,200}$'),
  auth         text not null check (auth ~ '^[A-Za-z0-9_-]{10,100}$'),
  locale       text not null default 'en' check (locale in ('en', 'am')),
  user_agent   text check (char_length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth, locale, user_agent) on public.push_subscriptions to authenticated;
create policy push_subscriptions_own_read on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_own_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_customer()));
create policy push_subscriptions_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- At most 10 devices per customer: the oldest is dropped.
create or replace function private.push_subscriptions_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions
   where user_id = new.user_id and id in (
     select id from public.push_subscriptions where user_id = new.user_id order by created_at desc offset 10);
  return null;
end;
$$;
create trigger push_subscriptions_limit after insert on public.push_subscriptions
  for each row execute function private.push_subscriptions_limit();

-- Outbox: new channel
alter table public.notifications_outbox drop constraint notifications_outbox_channel_check;
alter table public.notifications_outbox add constraint notifications_outbox_channel_check check (channel in ('telegram', 'email', 'push'));
alter table public.notifications_outbox drop constraint notifications_outbox_email_recipient;
alter table public.notifications_outbox add constraint notifications_outbox_email_recipient
  check (channel = 'telegram' or recipient_user_id is not null);

-- Each customer event: email + phone notification.
create or replace function private.enqueue_customer_email(p_event text, p_dedupe text, p_user uuid, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, recipient_user_id, max_attempts)
  select c.channel, p_event, c.prefix || p_dedupe, p_payload, p_user, c.attempts
    from (values ('email', '', 6), ('push', 'push:', 4)) c(channel, prefix, attempts)
   where p_user is not null
     and (c.channel = 'email' or exists (select 1 from public.push_subscriptions s where s.user_id = p_user))
  on conflict (dedupe_key) do nothing;
$$;

-- Worker: the customer's devices (service_role only).
create or replace function public.push_targets(p_user_id uuid)
returns table (id uuid, endpoint text, p256dh text, auth text, locale text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.endpoint, s.p256dh, s.auth, s.locale from public.push_subscriptions s where s.user_id = p_user_id
$$;
revoke execute on function public.push_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_targets(uuid) to service_role;
