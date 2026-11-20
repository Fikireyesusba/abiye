-- =============================================================================
-- 0035 SECURITY ALERTS CAN BE CLEARED ("mark as reviewed")
--   A reviewed email / customer leaves the suspicious lists and the red badge; it comes back
--   only if something new happens after the review. Events themselves are kept.
-- =============================================================================

create table public.security_reviews (
  subject_type text not null check (subject_type in ('email', 'customer')),
  subject      text not null check (char_length(subject) between 3 and 320),
  reviewed_at  timestamptz not null default now(),
  reviewed_by  uuid references auth.users(id) on delete set null,
  note         text check (char_length(note) <= 500),
  primary key (subject_type, subject)
);
alter table public.security_reviews enable row level security;
revoke all on public.security_reviews from anon, authenticated;
-- Read/write only through the functions below.

create or replace function private.reviewed_at(p_type text, p_subject text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$ select reviewed_at from public.security_reviews where subject_type = p_type and subject = lower(p_subject) $$;

-- Mark one or many as reviewed (security.manage = Super Admin).
create or replace function public.admin_mark_security_reviewed(p_type text, p_subjects text[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.require_permission('security.manage');
  if p_type not in ('email', 'customer') or p_subjects is null or cardinality(p_subjects) = 0 or cardinality(p_subjects) > 500 then
    perform private.app_error('invalid_request');
  end if;
  if p_note is not null and char_length(p_note) > 500 then perform private.app_error('invalid_request', 'note'); end if;
  insert into public.security_reviews (subject_type, subject, reviewed_at, reviewed_by, note)
  select p_type, lower(btrim(s)), now(), auth.uid(), nullif(btrim(p_note), '')
    from unnest(p_subjects) s
   where char_length(btrim(s)) between 3 and 320
  on conflict (subject_type, subject) do update set reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by, note = excluded.note;
  get diagnostics v_n = row_count;
  perform private.audit('security_reviewed', 'security', p_type, null, null,
                        jsonb_build_object('type', p_type, 'count', v_n, 'subjects', to_jsonb(p_subjects[1:20]), 'note', p_note));
  return v_n;
end;
$$;

-- Suspicious emails: only events after the email's last review count.
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
      left join public.security_reviews r on r.subject_type = 'email' and r.subject = lower(s.email)
     where s.email is not null and s.kind <> 'admin_login_success'
       and s.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 180)))
       and (r.reviewed_at is null or s.created_at > r.reviewed_at)
     group by s.email)
  select e.email, e.fa, e.fm, e.fc, e.fb, e.rl, e.nets, e.last,
         exists (select 1 from auth.users u where lower(u.email) = e.email),
         exists (select 1 from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = e.email),
         private.email_is_blocked(e.email),
         e.fa * 3 + e.fm * 4 + e.fc + e.fb * 2 + e.rl * 2 + greatest(e.nets - 1, 0) * 2
    from e
   order by 12 desc, e.last desc
   limit 300;
end;
$$;

-- Suspicious customers: only behaviour after the customer's last review counts.
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
  with base as (
    select u.id, u.email::text as email, ca.full_name, ca.deactivated_at is not null as deact,
           greatest(v_since, coalesce(private.reviewed_at('customer', u.id::text), v_since)) as since
      from auth.users u
      left join public.customer_accounts ca on ca.id = u.id
     where not exists (select 1 from public.profiles p where p.id = u.id)),
  c as (
    select b.id, b.email, b.full_name, b.deact,
      (select count(*) from public.orders o where o.user_id = b.id and o.status = 'expired' and o.created_at > b.since) as exp,
      (select count(*) from public.orders o where o.user_id = b.id and o.status = 'cancelled' and o.payment_verified_at is null and o.created_at > b.since) as canc,
      (select count(*) from public.payment_submissions s join public.orders o on o.id = s.order_id
        where o.user_id = b.id and s.status = 'rejected' and s.submitted_at > b.since) as rejp,
      (select count(*) from public.wallet_topups t where t.user_id = b.id and t.status = 'rejected' and t.created_at > b.since) as rejt,
      (select count(*) from public.payment_submissions s join public.orders o on o.id = s.order_id
        where o.user_id = b.id and s.submitted_at > b.since and (
          exists (select 1 from public.payment_submissions s2 join public.orders o2 on o2.id = s2.order_id
                   where o2.user_id <> b.id and (s2.receipt_sha256 = s.receipt_sha256
                     or (s.transaction_reference is not null and lower(s2.transaction_reference) = lower(s.transaction_reference))))
          or exists (select 1 from public.wallet_topups t where t.user_id <> b.id and t.receipt_sha256 = s.receipt_sha256))) as reused,
      (select count(*) from public.security_events e where lower(e.email) = lower(b.email) and e.kind = 'customer_login_failed' and e.created_at > b.since) as fails,
      (select floor(extract(epoch from now() - k.updated_at) / 3600)::integer from public.customer_carts k
        where k.user_id = b.id and k.item_count > 0 and k.updated_at > b.since) as idle
    from base b)
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

-- Recently reviewed (for the page).
create or replace function public.admin_security_reviews(p_limit integer default 50)
returns table (subject_type text, subject text, reviewed_at timestamptz, reviewed_by_name text, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  return query
    select r.subject_type, case when r.subject_type = 'customer' then coalesce((select u.email::text from auth.users u where u.id::text = r.subject), r.subject) else r.subject end,
           r.reviewed_at, private.actor_name(r.reviewed_by), r.note
      from public.security_reviews r order by r.reviewed_at desc limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.admin_mark_security_reviewed(text, text[], text) from public, anon;
revoke all on function public.admin_security_reviews(integer) from public, anon;
revoke all on function private.reviewed_at(text, text) from public;
grant execute on function public.admin_mark_security_reviewed(text, text[], text) to authenticated;
grant execute on function public.admin_security_reviews(integer) to authenticated;
