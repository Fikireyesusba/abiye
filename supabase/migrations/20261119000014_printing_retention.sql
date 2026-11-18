-- =============================================================================
-- 0014 PRINTING: file retention + admin file deletion
-- Customer documents are deleted after printing_jobs.files_delete_after
-- (set from the "retention_days" setting), but NEVER while the job is being
-- paid for or produced (payment_verification / printing / ready).
-- Storage objects are removed by server code; these functions keep the DB in sync.
-- =============================================================================

alter table public.printing_jobs
  add constraint printing_jobs_paper_size_check check (paper_size ~ '^[A-Za-z0-9]{1,10}$');

-- Cron worker (service_role): which stored files are due for deletion?
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
    and j.files_delete_after < now()
    and j.status not in ('payment_verification', 'printing', 'ready')
  order by j.files_delete_after
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- Cron worker (service_role): record files whose storage objects were removed.
create or replace function public.mark_printing_files_deleted(p_file_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.printing_files set deleted_at = now()
   where id = any(p_file_ids) and deleted_at is null;
  get diagnostics v_count = row_count;
  update public.printing_jobs j set files_deleted_at = now()
   where j.files_deleted_at is null
     and j.id in (select job_id from public.printing_files where id = any(p_file_ids))
     and not exists (select 1 from public.printing_files f where f.job_id = j.id and f.deleted_at is null);
  return v_count;
end;
$$;

-- Admin (printing.manage): mark a job's files deleted after removing them from Storage.
create or replace function public.admin_mark_printing_files_deleted(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.print_job_status;
  v_ids uuid[];
begin
  perform private.require_permission('printing.manage');
  select status into v_status from public.printing_jobs where id = p_job_id;
  if not found then perform private.app_error('not_found'); end if;
  if v_status in ('payment_verification', 'printing', 'ready') then
    perform private.app_error('invalid_transition', 'files are needed for this job');
  end if;
  select array_agg(id) into v_ids from public.printing_files where job_id = p_job_id and deleted_at is null;
  perform private.audit('printing_files_deleted', 'printing_job', p_job_id::text, null,
                        jsonb_build_object('files', coalesce(array_length(v_ids, 1), 0)));
  return public.mark_printing_files_deleted(coalesce(v_ids, '{}'));
end;
$$;

revoke execute on function public.printing_files_due_for_deletion(integer) from public, anon, authenticated;
revoke execute on function public.mark_printing_files_deleted(uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_mark_printing_files_deleted(uuid) from public, anon;
grant execute on function public.printing_files_due_for_deletion(integer) to service_role;
grant execute on function public.mark_printing_files_deleted(uuid[]) to service_role;
grant execute on function public.admin_mark_printing_files_deleted(uuid) to authenticated;
