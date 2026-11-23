-- 0065: customer uploads are virus-scanned (Cloudmersive) before they are accepted.
--   * New security events: upload_blocked (the scan found something — file deleted, upload refused) and
--     scan_unavailable (the scanner could not be reached — upload refused, nothing unscanned is kept).
--   * A blocked upload makes the account high-risk at once (active alert on the Security page).

alter table public.security_events drop constraint if exists security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check check (kind in (
  'admin_login_failed', 'admin_login_not_staff', 'admin_mfa_failed', 'admin_login_success',
  'customer_login_failed', 'staff_customer_login', 'login_blocked', 'signup_blocked', 'rate_limited',
  'upload_blocked', 'scan_unavailable'));

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
         + count(*) filter (where s.kind = 'upload_blocked') * 6
         + greatest(count(distinct s.ip_hash) - 1, 0) * 2, 0)::int
    from public.security_events s
    left join public.security_reviews r on r.subject_type = 'email' and r.subject = lower(s.email)
   where lower(s.email) = lower(p_email) and s.kind not in ('admin_login_success', 'scan_unavailable')
     and s.created_at > now() - interval '24 hours'
     and (r.reviewed_at is null or s.created_at > r.reviewed_at)
$$;
revoke all on function private.email_risk_24h(text) from public;
