-- =============================================================================
-- 0006 OPERATIONS: notification outbox, audit log, rate limiting
-- =============================================================================

-- Transactional outbox: rows are written in the SAME transaction as the
-- business change, so a Telegram outage can never lose or block an order.
create table public.notifications_outbox (
  id                bigint generated always as identity primary key,
  channel           text not null default 'telegram' check (channel in ('telegram')),
  event_type        text not null check (event_type ~ '^[a-z_]{3,60}$'),
  dedupe_key        text not null unique,          -- prevents duplicate sends on retries
  payload           jsonb not null,
  attachment_bucket text,
  attachment_path   text,
  status            public.notification_status not null default 'pending',
  attempts          integer not null default 0,
  max_attempts      integer not null default 8,
  next_attempt_at   timestamptz not null default now(),
  locked_until      timestamptz,
  last_error        text,
  sent_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index notifications_outbox_due_idx on public.notifications_outbox(next_attempt_at)
  where status in ('pending', 'failed');

create or replace function private.enqueue_notification(
  p_event_type text, p_dedupe_key text, p_payload jsonb,
  p_attachment_bucket text default null, p_attachment_path text default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications_outbox (event_type, dedupe_key, payload, attachment_bucket, attachment_path)
  values (p_event_type, p_dedupe_key, p_payload, p_attachment_bucket, p_attachment_path)
  on conflict (dedupe_key) do nothing;
$$;

-- Worker API (service_role only): claim a batch with SKIP LOCKED so concurrent
-- workers never send the same message twice.
create or replace function public.claim_notifications(p_limit integer default 10)
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
      where (status in ('pending', 'failed') and next_attempt_at <= now())
         or (status = 'processing' and locked_until < now())   -- crashed worker
      order by id
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning o.*;
$$;

create or replace function public.complete_notification(p_id bigint, p_success boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications_outbox
     set status = case when p_success then 'sent'::public.notification_status
                       when attempts >= max_attempts then 'dead'::public.notification_status
                       else 'failed'::public.notification_status end,
         sent_at = case when p_success then now() end,
         last_error = case when p_success then null else left(p_error, 1000) end,
         -- exponential backoff: 1, 2, 4, 8 ... minutes, capped at 1 hour
         next_attempt_at = now() + least(interval '1 hour', interval '1 minute' * power(2, greatest(attempts - 1, 0))),
         locked_until = null
   where id = p_id and status = 'processing';
$$;

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before_data jsonb,
  after_data  jsonb,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.prevent_audit_mutation();

create or replace function private.audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_metadata jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, before_data, after_data, metadata)
  values ((select auth.uid()), private.current_role_key(), p_action, p_entity_type, p_entity_id,
          p_before, p_after, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Generic row-level audit trigger for sensitive configuration tables.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  v_id := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'key');
  perform private.audit(
    lower(tg_op), tg_table_name, v_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;

create trigger audit_bank_accounts after insert or update or delete on public.bank_accounts
  for each row execute function private.audit_row_change();
create trigger audit_website_settings after insert or update or delete on public.website_settings
  for each row execute function private.audit_row_change();
create trigger audit_delivery_zones after insert or update or delete on public.delivery_zones
  for each row execute function private.audit_row_change();
create trigger audit_printing_price_rules after insert or update or delete on public.printing_price_rules
  for each row execute function private.audit_row_change();
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function private.audit_row_change();
create trigger audit_role_permissions after insert or delete on public.role_permissions
  for each row execute function private.audit_row_change();
create trigger audit_promotions after insert or update or delete on public.promotions
  for each row execute function private.audit_row_change();
-- Products: audit catalog edits, but not routine stock movements (those are
-- already recorded in inventory_movements).
create trigger audit_products after insert or delete or update of
    name_en, name_am, sku, slug, category_id, price_etb, sale_price_etb, status, is_featured
  on public.products
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, works across serverless instances)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  -- opportunistic cleanup (~1% of calls)
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;
