-- 0066: history of every virus scan of a customer upload (Cloudmersive), kept in our own database:
-- who (User ID), what kind of upload, file type / size / fingerprint (sha256), the result (clean / blocked /
-- scanner unavailable), what was found and how long it took. Admin → Security → File scans; the payment,
-- top-up and printing pages show the scan of their exact file (matched by fingerprint). Kept 1 year.

create table public.upload_scans (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  member_id   text check (member_id ~ '^[1-9][0-9]{5}$'),
  source      text not null check (source in ('payment_receipt', 'topup_receipt', 'printing_file')),
  ref         text check (char_length(ref) <= 64),
  file_type   text not null check (file_type ~ '^[a-z0-9.+/-]{1,80}$'),
  size_bytes  integer not null check (size_bytes >= 0),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  result      text not null check (result in ('clean', 'blocked', 'unavailable')),
  findings    text check (char_length(findings) <= 500),
  duration_ms integer check (duration_ms >= 0),
  scanner     text not null default 'cloudmersive' check (scanner in ('cloudmersive'))
);
create index upload_scans_created_idx on public.upload_scans (created_at desc);
create index upload_scans_sha_idx on public.upload_scans (sha256);
create index upload_scans_user_idx on public.upload_scans (user_id);

alter table public.upload_scans enable row level security;
revoke all on public.upload_scans from anon, authenticated;
grant select on public.upload_scans to authenticated;
create policy upload_scans_staff_read on public.upload_scans for select to authenticated
  using ((select private.has_permission('audit.view')) or (select private.has_permission('payments.view'))
         or (select private.has_permission('wallet.manage')) or (select private.has_permission('printing.view')));
-- Rows are written only by the server (record_upload_scan); nobody edits or deletes them (kept 1 year).

create or replace function public.record_upload_scan(
  p_user_id uuid, p_source text, p_ref text, p_file_type text, p_size integer, p_sha256 text,
  p_result text, p_findings text default null, p_duration_ms integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.upload_scans (user_id, member_id, source, ref, file_type, size_bytes, sha256, result, findings, duration_ms)
  values (p_user_id, private.member_of(p_user_id), p_source, left(p_ref, 64), p_file_type, p_size, p_sha256, p_result,
          left(p_findings, 500), p_duration_ms);
  delete from public.upload_scans where id in (
    select id from public.upload_scans where created_at < now() - interval '365 days' order by id limit 200);
end;
$$;
revoke all on function public.record_upload_scan(uuid, text, text, text, integer, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_upload_scan(uuid, text, text, text, integer, text, text, text, integer) to service_role;
