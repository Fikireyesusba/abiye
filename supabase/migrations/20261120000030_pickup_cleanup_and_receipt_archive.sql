-- =============================================================================
-- 0030 (1) Printing documents are deleted once the job is picked up (Completed).
--      (2) Payment receipts are archived by email when verified or rejected.
-- =============================================================================

-- (1) Completed = picked up: the files are due for deletion immediately. The app removes them
-- right away; if that fails, the daily storage maintenance job removes them.
create or replace function private.printing_files_due_on_pickup()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.files_delete_after := now();
  end if;
  return new;
end;
$$;
drop trigger if exists printing_jobs_files_due_on_pickup on public.printing_jobs;
create trigger printing_jobs_files_due_on_pickup before update of status on public.printing_jobs
  for each row execute function private.printing_files_due_on_pickup();

-- Due "now" means now (inclusive).
create or replace function public.printing_files_due_for_deletion(p_limit integer default 200)
returns table (file_id uuid, job_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.job_id, f.storage_path
  from public.printing_files f
  join public.printing_jobs j on j.id = f.job_id
  where f.deleted_at is null
    and j.files_delete_after <= now()
    and j.status not in ('payment_verification', 'printing', 'ready')
  order by j.files_delete_after
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- Jobs completed earlier: their files are due now too.
update public.printing_jobs set files_delete_after = now()
 where status = 'completed' and files_deleted_at is null and (files_delete_after is null or files_delete_after > now());

-- (2) Receipt archive ---------------------------------------------------------
alter table public.notifications_outbox drop constraint notifications_outbox_channel_check;
alter table public.notifications_outbox add constraint notifications_outbox_channel_check check (channel in ('telegram', 'email', 'push', 'archive'));
-- Archive emails go to the business's archive address, not to a customer.
alter table public.notifications_outbox drop constraint notifications_outbox_email_recipient;
alter table public.notifications_outbox add constraint notifications_outbox_email_recipient
  check (channel in ('telegram', 'archive') or recipient_user_id is not null);

-- Archive address: private setting (never public), changed only through admin_set_receipt_archive.
create or replace function public.admin_set_receipt_archive(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_old text := private.setting('receipt_archive') ->> 'email';
begin
  perform private.require_permission('settings.manage');
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$') then
    perform private.app_error('invalid_request', 'email');
  end if;
  insert into public.website_settings (key, value, is_public, updated_by)
  values ('receipt_archive', jsonb_build_object('email', v_email), false, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = false, updated_by = excluded.updated_by;
  perform private.audit('receipt_archive_set', 'website_settings', 'receipt_archive',
                        jsonb_build_object('email', v_old), jsonb_build_object('email', v_email));
end;
$$;

create or replace function private.archive_payment_receipt(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, attachment_bucket, attachment_path, max_attempts)
  select 'archive', 'receipt_archive', 'archive:payment:' || s.id || ':' || s.status,
         jsonb_build_object(
           'kind', 'order_payment', 'result', s.status, 'number', o.order_number, 'amount_etb', s.amount_expected_etb,
           'order_total_etb', o.total_etb, 'reference', s.transaction_reference, 'customer_name', o.customer_name,
           'customer_phone', o.customer_phone, 'customer_email', u.email::text,
           'bank_name', o.bank_snapshot ->> 'bank_name', 'account_number', o.bank_snapshot ->> 'account_number',
           'submitted_at', s.submitted_at, 'decided_at', s.reviewed_at, 'decided_by', private.actor_name(s.reviewed_by),
           'reason', s.review_note, 'receipt_name', s.receipt_original_name, 'receipt_mime', s.receipt_mime, 'receipt_sha256', s.receipt_sha256),
         'payment-receipts', s.receipt_path, 20
    from public.payment_submissions s
    join public.orders o on o.id = s.order_id
    left join auth.users u on u.id = o.user_id
   where s.id = p_id and s.status::text in ('verified', 'rejected')
     and private.setting('receipt_archive') ->> 'email' is not null
  on conflict (dedupe_key) do nothing;
$$;

create or replace function private.archive_topup_receipt(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, attachment_bucket, attachment_path, max_attempts)
  select 'archive', 'receipt_archive', 'archive:topup:' || t.id || ':' || t.status,
         jsonb_build_object(
           'kind', 'wallet_topup', 'result', t.status, 'number', t.topup_number, 'amount_etb', t.amount_etb,
           'reference', t.transaction_reference, 'customer_name', a.full_name, 'customer_phone', a.phone, 'customer_email', u.email::text,
           'bank_name', t.bank_snapshot ->> 'bank_name', 'account_number', t.bank_snapshot ->> 'account_number',
           'submitted_at', t.created_at, 'decided_at', t.reviewed_at, 'decided_by', private.actor_name(t.reviewed_by),
           'reason', t.review_note, 'receipt_mime', t.receipt_mime, 'receipt_sha256', t.receipt_sha256),
         'payment-receipts', t.receipt_path, 20
    from public.wallet_topups t
    left join public.customer_accounts a on a.id = t.user_id
    left join auth.users u on u.id = t.user_id
   where t.id = p_id and t.status in ('verified', 'rejected')
     and private.setting('receipt_archive') ->> 'email' is not null
  on conflict (dedupe_key) do nothing;
$$;

-- Queued in the same transaction as the decision.
create or replace function private.archive_on_payment_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text in ('verified', 'rejected') and old.status::text is distinct from new.status::text then
    if tg_table_name = 'payment_submissions' then perform private.archive_payment_receipt(new.id);
    else perform private.archive_topup_receipt(new.id);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists payment_submissions_archive on public.payment_submissions;
create trigger payment_submissions_archive after update of status on public.payment_submissions
  for each row execute function private.archive_on_payment_decision();
drop trigger if exists wallet_topups_archive on public.wallet_topups;
create trigger wallet_topups_archive after update of status on public.wallet_topups
  for each row execute function private.archive_on_payment_decision();

-- Send receipts decided before the archive was set up (or in a period). Duplicates are skipped.
create or replace function public.admin_archive_past_receipts(p_from timestamptz, p_to timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_after integer;
begin
  perform private.require_permission('settings.manage');
  if p_from is null or p_to is null or p_to <= p_from then perform private.app_error('invalid_request'); end if;
  if private.setting('receipt_archive') ->> 'email' is null then perform private.app_error('invalid_request', 'archive_not_set'); end if;
  select count(*) into v_before from public.notifications_outbox where channel = 'archive';
  perform private.archive_payment_receipt(s.id) from public.payment_submissions s
   where s.status::text in ('verified', 'rejected') and s.reviewed_at >= p_from and s.reviewed_at < p_to;
  perform private.archive_topup_receipt(t.id) from public.wallet_topups t
   where t.status in ('verified', 'rejected') and t.reviewed_at >= p_from and t.reviewed_at < p_to;
  select count(*) into v_after from public.notifications_outbox where channel = 'archive';
  perform private.audit('receipt_archive_backfill', 'website_settings', 'receipt_archive', null, null,
                        jsonb_build_object('from', p_from, 'to', p_to, 'queued', v_after - v_before));
  return v_after - v_before;
end;
$$;

-- Admin overview of the archive (settings.manage).
create or replace function public.admin_receipt_archive_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return jsonb_build_object(
    'email', private.setting('receipt_archive') ->> 'email',
    'sent', (select count(*) from public.notifications_outbox where channel = 'archive' and status = 'sent'),
    'waiting', (select count(*) from public.notifications_outbox where channel = 'archive' and status in ('pending', 'processing', 'failed')),
    'dead', (select count(*) from public.notifications_outbox where channel = 'archive' and status = 'dead'),
    'last_sent_at', (select max(sent_at) from public.notifications_outbox where channel = 'archive'),
    'last_error', (select last_error from public.notifications_outbox where channel = 'archive' and last_error is not null order by id desc limit 1));
end;
$$;

-- Worker (service_role): the current archive address.
create or replace function public.receipt_archive_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select private.setting('receipt_archive') ->> 'email' $$;

-- Notifications list: show the order / top-up number of archive emails too.
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
           coalesce(o.payload ->> 'order_number', o.payload ->> 'job_number', o.payload ->> 'number', o.payload ->> 'label')
    from public.notifications_outbox o
    order by o.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.admin_set_receipt_archive(text) from public, anon;
revoke all on function public.admin_archive_past_receipts(timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_receipt_archive_status() from public, anon;
revoke all on function public.receipt_archive_email() from public, anon, authenticated;
revoke all on function private.archive_payment_receipt(uuid) from public;
revoke all on function private.archive_topup_receipt(uuid) from public;
grant execute on function public.admin_set_receipt_archive(text) to authenticated;
grant execute on function public.admin_archive_past_receipts(timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_receipt_archive_status() to authenticated;
grant execute on function public.receipt_archive_email() to service_role;
