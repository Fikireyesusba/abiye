-- =============================================================================
-- 0027 SECURITY & HEALTH MONITORING
--   * security_events: failed / blocked sign-ins (with the EMAIL that was
--     used), two-step failures, successful admin sign-ins, rate-limit hits.
--     Network addresses are stored only as a truncated hash.
--   * blocked_emails: an email on this list cannot sign up, sign in or order
--     (checked by the app AND by the database, incl. direct API sign-ups).
--   * Super Admin views: suspicious emails, suspicious customers, admin
--     sign-ins, site health (queues, overdue work, scheduled jobs).
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('security.manage', 'Block and unblock emails')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select id, 'security.manage' from public.admin_roles where key = 'super_admin'
on conflict do nothing;

create table public.security_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in (
               'admin_login_failed', 'admin_login_not_staff', 'admin_mfa_failed', 'admin_login_success',
               'customer_login_failed', 'staff_customer_login', 'login_blocked', 'signup_blocked', 'rate_limited')),
  email      text check (char_length(email) <= 254),
  user_id    uuid references auth.users(id) on delete set null,
  ip_hash    text check (ip_hash ~ '^[0-9a-f]{8,64}$'),
  user_agent text check (char_length(user_agent) <= 300),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index security_events_email_idx on public.security_events(email, created_at desc);
create index security_events_kind_idx on public.security_events(kind, created_at desc);

create table public.blocked_emails (
  email      text primary key check (email = lower(email) and char_length(email) between 3 and 254),
  reason     text not null check (char_length(reason) between 2 and 500),
  blocked_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.cron_runs (
  name        text primary key check (name ~ '^[a-z-]{3,40}$'),
  last_run_at timestamptz not null,
  last_ok     boolean not null,
  detail      jsonb not null default '{}'::jsonb
);

-- All three: server / definer functions only.
alter table public.security_events enable row level security;
alter table public.blocked_emails enable row level security;
alter table public.cron_runs enable row level security;
revoke all on public.security_events, public.blocked_emails, public.cron_runs from anon, authenticated;

create or replace function private.email_is_blocked(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocked_emails b where b.email = lower(btrim(coalesce(p_email, ''))))
$$;

-- Backstop for sign-ups made directly against the Supabase API.
create or replace function private.refuse_blocked_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.email_is_blocked(new.email) then
    raise exception using errcode = 'P0001', message = 'email_blocked';
  end if;
  return new;
end;
$$;
create trigger refuse_blocked_signup before insert on auth.users
  for each row execute function private.refuse_blocked_signup();

-- Ordering / top-ups: refuse blocked emails (on top of deactivation).
create or replace function private.assert_confirmed_user(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = p_user_id and email_confirmed_at is not null;
  if p_user_id is null or v_email is null then
    perform private.app_error('login_required');
  end if;
  if not private.is_active_user(p_user_id) then
    perform private.app_error('account_deactivated');
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    perform private.app_error('staff_account');
  end if;
  if private.email_is_blocked(v_email) then
    perform private.app_error('email_blocked');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Server API (service_role)
-- ---------------------------------------------------------------------------
create or replace function public.record_security_event(
  p_kind text, p_email text default null, p_user_id uuid default null, p_ip_hash text default null,
  p_user_agent text default null, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.security_events (kind, email, user_id, ip_hash, user_agent, metadata)
  values (p_kind, nullif(lower(btrim(left(coalesce(p_email, ''), 254))), ''), p_user_id, p_ip_hash, left(p_user_agent, 300),
          coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.is_email_blocked(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.email_is_blocked(p_email) $$;

create or replace function public.record_cron_run(p_name text, p_ok boolean, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.cron_runs (name, last_run_at, last_ok, detail) values (p_name, now(), p_ok, coalesce(p_detail, '{}'::jsonb))
  on conflict (name) do update set last_run_at = excluded.last_run_at, last_ok = excluded.last_ok, detail = excluded.detail;
$$;

-- Old events are removed after 180 days (called by the daily maintenance job).
create or replace function public.purge_security_events()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.security_events where created_at < now() - interval '180 days' returning 1)
  select count(*)::integer from d
$$;

-- ---------------------------------------------------------------------------
-- Super Admin: block / unblock
-- ---------------------------------------------------------------------------
create or replace function public.admin_block_email(p_email text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_user   uuid;
begin
  perform private.require_permission('security.manage');
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254 then perform private.app_error('invalid_request'); end if;
  if v_reason is null or char_length(v_reason) > 500 then perform private.app_error('invalid_reason'); end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null and exists (select 1 from public.profiles where id = v_user) then
    perform private.app_error('cannot_manage_staff');
  end if;
  insert into public.blocked_emails (email, reason) values (v_email, v_reason)
  on conflict (email) do update set reason = excluded.reason, blocked_by = auth.uid(), created_at = now();
  -- An existing customer account is deactivated (the app also bans its sign-in).
  if v_user is not null then
    insert into public.customer_accounts (id) values (v_user) on conflict do nothing;
    update public.customer_accounts
       set deactivated_at = coalesce(deactivated_at, now()), deactivated_by = coalesce(deactivated_by, auth.uid()),
           deactivation_reason = coalesce(deactivation_reason, left('Blocked email: ' || v_reason, 500))
     where id = v_user;
  end if;
  perform private.audit('email_blocked', 'security', v_email, null, null, jsonb_build_object('reason', v_reason, 'user_id', v_user));
  return jsonb_build_object('email', v_email, 'user_id', v_user);
end;
$$;

create or replace function public.admin_unblock_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
begin
  perform private.require_permission('security.manage');
  delete from public.blocked_emails where email = v_email;
  if not found then perform private.app_error('not_found'); end if;
  select id into v_user from auth.users where lower(email) = v_email;
  -- Reactivate only if the account was deactivated BY the block.
  if v_user is not null then
    update public.customer_accounts set deactivated_at = null, deactivated_by = null, deactivation_reason = null
     where id = v_user and deactivation_reason like 'Blocked email:%';
    if not found then v_user := null; end if;
  end if;
  perform private.audit('email_unblocked', 'security', v_email);
  return jsonb_build_object('email', v_email, 'reactivated_user_id', v_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- Super Admin views (audit.view)
-- ---------------------------------------------------------------------------
create or replace function public.admin_suspicious_emails(p_days integer default 7)
returns table (email text, failed_admin bigint, failed_mfa bigint, failed_customer bigint, blocked_attempts bigint, rate_limited bigint,
               networks bigint, last_seen timestamptz, has_account boolean, is_staff boolean, blocked boolean, score bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  return query
  with e as (
    select s.email,
           count(*) filter (where s.kind in ('admin_login_failed', 'admin_login_not_staff')) as fa,
           count(*) filter (where s.kind = 'admin_mfa_failed') as fm,
           count(*) filter (where s.kind = 'customer_login_failed') as fc,
           count(*) filter (where s.kind in ('login_blocked', 'signup_blocked')) as fb,
           count(*) filter (where s.kind = 'rate_limited') as rl,
           count(distinct s.ip_hash) as nets,
           max(s.created_at) as last
      from public.security_events s
     where s.email is not null and s.kind <> 'admin_login_success'
       and s.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 180)))
     group by s.email)
  select e.email, e.fa, e.fm, e.fc, e.fb, e.rl, e.nets, e.last,
         exists (select 1 from auth.users u where lower(u.email) = e.email),
         exists (select 1 from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = e.email),
         private.email_is_blocked(e.email),
         -- admin attempts weigh more than customer typos
         e.fa * 3 + e.fm * 4 + e.fc + e.fb * 2 + e.rl * 2 + greatest(e.nets - 1, 0) * 2
    from e
   order by 12 desc, e.last desc
   limit 300;
end;
$$;

create or replace function public.admin_suspicious_customers(p_days integer default 30)
returns table (user_id uuid, email text, full_name text, expired_orders bigint, cancelled_unpaid bigint, rejected_payments bigint,
               rejected_topups bigint, reused_receipts bigint, failed_logins bigint, idle_basket_hours integer,
               deactivated boolean, blocked boolean, reasons text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  perform private.require_permission('audit.view');
  return query
  with c as (
    select u.id, u.email::text as email, ca.full_name, ca.deactivated_at is not null as deact,
      (select count(*) from public.orders o where o.user_id = u.id and o.status = 'expired' and o.created_at > v_since) as exp,
      (select count(*) from public.orders o where o.user_id = u.id and o.status = 'cancelled' and o.payment_verified_at is null and o.created_at > v_since) as canc,
      (select count(*) from public.payment_submissions s join public.orders o on o.id = s.order_id
        where o.user_id = u.id and s.status = 'rejected' and s.submitted_at > v_since) as rejp,
      (select count(*) from public.wallet_topups t where t.user_id = u.id and t.status = 'rejected' and t.created_at > v_since) as rejt,
      (select count(*) from public.payment_submissions s join public.orders o on o.id = s.order_id
        where o.user_id = u.id and s.submitted_at > v_since and (
          exists (select 1 from public.payment_submissions s2 join public.orders o2 on o2.id = s2.order_id
                   where o2.user_id <> u.id and (s2.receipt_sha256 = s.receipt_sha256
                     or (s.transaction_reference is not null and lower(s2.transaction_reference) = lower(s.transaction_reference))))
          or exists (select 1 from public.wallet_topups t where t.user_id <> u.id and t.receipt_sha256 = s.receipt_sha256))) as reused,
      (select count(*) from public.security_events e where lower(e.email) = lower(u.email::text) and e.kind = 'customer_login_failed' and e.created_at > v_since) as fails,
      (select floor(extract(epoch from now() - k.updated_at) / 3600)::integer from public.customer_carts k where k.user_id = u.id and k.item_count > 0) as idle
    from auth.users u
    left join public.customer_accounts ca on ca.id = u.id
    where not exists (select 1 from public.profiles p where p.id = u.id))
  select c.id, c.email, c.full_name, c.exp, c.canc, c.rejp, c.rejt, c.reused, c.fails, c.idle, c.deact, private.email_is_blocked(c.email),
         array_remove(array[
           case when c.exp + c.canc >= 3 then 'Many orders placed but never paid' end,
           case when c.rejp + c.rejt >= 2 then 'Several receipts rejected' end,
           case when c.reused > 0 then 'Receipt or bank reference also used by another customer' end,
           case when c.fails >= 5 then 'Many failed sign-ins' end,
           case when c.idle >= 72 and c.exp + c.canc >= 1 then 'Leaves baskets and unpaid orders repeatedly' end], null)
    from c
   where c.exp + c.canc >= 3 or c.rejp + c.rejt >= 2 or c.reused > 0 or c.fails >= 5 or (c.idle >= 72 and c.exp + c.canc >= 1)
   order by (c.reused * 5 + (c.rejp + c.rejt) * 3 + c.exp + c.canc + c.fails) desc
   limit 200;
end;
$$;

create or replace function public.admin_security_events(p_kind text default null, p_email text default null, p_limit integer default 100)
returns table (id bigint, kind text, email text, user_name text, ip_hash text, user_agent text, metadata jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  return query
    select s.id, s.kind, s.email, private.actor_name(s.user_id), left(s.ip_hash, 8), s.user_agent, s.metadata, s.created_at
      from public.security_events s
     where (p_kind is null or s.kind = p_kind) and (p_email is null or s.email = lower(btrim(p_email)))
     order by s.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.admin_blocked_emails()
returns table (email text, reason text, blocked_by text, created_at timestamptz, has_account boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  return query
    select b.email, b.reason, private.actor_name(b.blocked_by), b.created_at,
           exists (select 1 from auth.users u where lower(u.email) = b.email)
      from public.blocked_emails b order by b.created_at desc;
end;
$$;

-- Site health: queues, overdue work, scheduled jobs, alerts in the last 24 h.
create or replace function public.admin_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  return jsonb_build_object(
    'outbox', (select coalesce(jsonb_object_agg(channel, x), '{}'::jsonb) from (
        select channel, jsonb_build_object(
          'pending', count(*) filter (where status in ('pending', 'processing')),
          'failed', count(*) filter (where status = 'failed'),
          'dead_7d', count(*) filter (where status = 'dead' and created_at > now() - interval '7 days'),
          'oldest_pending', min(created_at) filter (where status in ('pending', 'failed'))) as x
          from public.notifications_outbox group by channel) t),
    'payments_pending', (select count(*) from public.payment_submissions where status = 'pending'),
    'payments_oldest', (select min(submitted_at) from public.payment_submissions where status = 'pending'),
    'topups_pending', (select count(*) from public.wallet_topups where status = 'pending'),
    'topups_oldest', (select min(created_at) from public.wallet_topups where status = 'pending'),
    'overdue_unexpired', (select count(*) from public.orders where status in ('awaiting_payment', 'payment_rejected') and payment_due_at < now() - interval '2 hours'),
    'paid_waiting_24h', (select count(*) from public.orders where status = 'confirmed' and payment_verified_at < now() - interval '24 hours'),
    'out_of_stock', (select count(*) from public.products where status = 'active' and track_inventory and stock_quantity <= 0),
    'cron', (select coalesce(jsonb_object_agg(name, jsonb_build_object('last_run_at', last_run_at, 'ok', last_ok, 'detail', detail)), '{}'::jsonb) from public.cron_runs),
    'events_24h', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select kind, count(*) as n from public.security_events where created_at > now() - interval '24 hours' group by kind) k),
    'blocked_emails', (select count(*) from public.blocked_emails)
  );
end;
$$;

-- Grants
revoke execute on function public.record_security_event(text, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.is_email_blocked(text) from public, anon, authenticated;
revoke execute on function public.record_cron_run(text, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.purge_security_events() from public, anon, authenticated;
grant execute on function public.record_security_event(text, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.is_email_blocked(text) to service_role;
grant execute on function public.record_cron_run(text, boolean, jsonb) to service_role;
grant execute on function public.purge_security_events() to service_role;
revoke execute on function public.admin_block_email(text, text) from public, anon;
revoke execute on function public.admin_unblock_email(text) from public, anon;
revoke execute on function public.admin_suspicious_emails(integer) from public, anon;
revoke execute on function public.admin_suspicious_customers(integer) from public, anon;
revoke execute on function public.admin_security_events(text, text, integer) from public, anon;
revoke execute on function public.admin_blocked_emails() from public, anon;
revoke execute on function public.admin_system_health() from public, anon;
grant execute on function public.admin_block_email(text, text) to authenticated;
grant execute on function public.admin_unblock_email(text) to authenticated;
grant execute on function public.admin_suspicious_emails(integer) to authenticated;
grant execute on function public.admin_suspicious_customers(integer) to authenticated;
grant execute on function public.admin_security_events(text, text, integer) to authenticated;
grant execute on function public.admin_blocked_emails() to authenticated;
grant execute on function public.admin_system_health() to authenticated;
