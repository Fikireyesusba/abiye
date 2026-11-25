-- =============================================================================
-- 0076 DOCUMENTS (EMPLOYEES AND VEHICLES) + VEHICLE REGISTER
--   * vehicles: cars, motorcycles and bicycles (the shop's own or a courier's): plate, make, model, year, colour,
--     chassis / engine numbers, libre (registration book) number, insurance, annual inspection (Bolo), who rides it.
--   * documents: files for an employee (Fayda, passport, contract, driving licence, CV, guarantee…) or a vehicle
--     (libre, insurance, Bolo, photos…), with issue / expiry dates. Files in the PRIVATE bucket "staff-documents"
--     (virus-scanned by the server before they are stored); opened with short-lived links by staff with
--     documents.manage only. File contents and numbers are never copied into the Activity log or Telegram.
--   * Expiry alerts (security group, once per item and date): documents, vehicle insurance / Bolo and couriers'
--     driving licences expiring within 30 days (or already expired). Checked with the delivery monitor.
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('documents.manage', 'Employee and vehicle documents, vehicle register')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'documents.manage' from public.admin_roles r where r.key = 'super_admin'
on conflict do nothing;

alter table public.upload_scans drop constraint if exists upload_scans_source_check;
alter table public.upload_scans add constraint upload_scans_source_check
  check (source in ('payment_receipt', 'topup_receipt', 'printing_file', 'staff_document'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-documents', 'staff-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Read (signed links) only with documents.manage; files are written / removed by the server only.
create policy "staff documents: managers read" on storage.objects for select to authenticated
  using (bucket_id = 'staff-documents' and (select private.has_permission('documents.manage')));

create table public.vehicles (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('motorcycle', 'car', 'bicycle', 'three_wheeler')),
  owner             text not null default 'company' check (owner in ('company', 'courier')),
  plate_number      text unique check (plate_number ~ '^[A-Z0-9 -]{2,20}$'),
  make              text check (char_length(make) <= 40),
  model             text check (char_length(model) <= 40),
  year              integer check (year between 1950 and 2100),
  colour            text check (char_length(colour) <= 30),
  chassis_number    text check (char_length(chassis_number) <= 40),
  engine_number     text check (char_length(engine_number) <= 40),
  libre_number      text check (char_length(libre_number) <= 40),
  insurance_company text check (char_length(insurance_company) <= 80),
  insurance_policy  text check (char_length(insurance_policy) <= 40),
  insurance_expiry  date,
  inspection_expiry date,
  assigned_to       uuid references public.profiles(id) on delete set null,
  status            text not null default 'active' check (status in ('active', 'in_repair', 'retired')),
  notes             text check (char_length(notes) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (kind = 'bicycle' or plate_number is not null)
);
create index vehicles_assigned_idx on public.vehicles (assigned_to) where assigned_to is not null;
create trigger vehicles_updated_at before update on public.vehicles for each row execute function private.set_updated_at();

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  vehicle_id   uuid references public.vehicles(id) on delete cascade,
  kind         text not null check (kind in ('fayda', 'passport', 'contract', 'driving_licence', 'cv', 'certificate', 'guarantee', 'medical', 'photo',
                                              'libre', 'insurance', 'inspection', 'purchase', 'other')),
  title        text not null check (char_length(title) between 1 and 120),
  file_path    text not null unique check (file_path ~ '^(staff|vehicle)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
  mime         text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes   integer not null check (size_bytes between 1 and 10485760),
  issued_on    date,
  expires_on   date,
  notes        text check (char_length(notes) <= 500),
  uploaded_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  check ((profile_id is null) <> (vehicle_id is null))
);
create index documents_profile_idx on public.documents (profile_id) where profile_id is not null;
create index documents_vehicle_idx on public.documents (vehicle_id) where vehicle_id is not null;
create index documents_expiry_idx on public.documents (expires_on) where expires_on is not null;

alter table public.vehicles enable row level security;
alter table public.documents enable row level security;
revoke all on public.vehicles, public.documents from anon, authenticated;
grant select on public.vehicles, public.documents to authenticated;
create policy vehicles_read on public.vehicles for select to authenticated
  using ((select private.has_permission('documents.manage')) or assigned_to = (select auth.uid()));
create policy documents_read on public.documents for select to authenticated
  using ((select private.has_permission('documents.manage')));

-- ------------------------------------------------------------ vehicles
create or replace function public.admin_save_vehicle(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind text := p ->> 'kind';
  v_plate text := nullif(upper(btrim(coalesce(p ->> 'plate_number', ''))), '');
  v_assigned uuid := nullif(p ->> 'assigned_to', '')::uuid;
begin
  perform private.require_permission('documents.manage');
  if v_kind not in ('motorcycle', 'car', 'bicycle', 'three_wheeler') or (v_kind <> 'bicycle' and v_plate is null)
     or coalesce(p ->> 'owner', 'company') not in ('company', 'courier')
     or coalesce(p ->> 'status', 'active') not in ('active', 'in_repair', 'retired') then
    perform private.app_error('invalid_request');
  end if;
  if v_assigned is not null and not exists (select 1 from public.profiles where id = v_assigned and removed_at is null) then
    perform private.app_error('invalid_assignee');
  end if;
  if v_plate is not null and exists (select 1 from public.vehicles where plate_number = v_plate and id is distinct from p_id) then
    perform private.app_error('invalid_request', 'plate taken');
  end if;
  if p_id is null then
    insert into public.vehicles (kind, owner, plate_number) values (v_kind, coalesce(p ->> 'owner', 'company'), v_plate) returning id into v_id;
  else
    v_id := p_id;
    if not exists (select 1 from public.vehicles where id = v_id) then perform private.app_error('not_found'); end if;
  end if;
  update public.vehicles set
    kind = v_kind, owner = coalesce(p ->> 'owner', 'company'), plate_number = v_plate,
    make = nullif(btrim(coalesce(p ->> 'make', '')), ''), model = nullif(btrim(coalesce(p ->> 'model', '')), ''),
    year = nullif(p ->> 'year', '')::integer, colour = nullif(btrim(coalesce(p ->> 'colour', '')), ''),
    chassis_number = nullif(upper(btrim(coalesce(p ->> 'chassis_number', ''))), ''), engine_number = nullif(upper(btrim(coalesce(p ->> 'engine_number', ''))), ''),
    libre_number = nullif(upper(btrim(coalesce(p ->> 'libre_number', ''))), ''),
    insurance_company = nullif(btrim(coalesce(p ->> 'insurance_company', '')), ''), insurance_policy = nullif(btrim(coalesce(p ->> 'insurance_policy', '')), ''),
    insurance_expiry = nullif(p ->> 'insurance_expiry', '')::date, inspection_expiry = nullif(p ->> 'inspection_expiry', '')::date,
    assigned_to = v_assigned, status = coalesce(p ->> 'status', 'active'), notes = nullif(btrim(coalesce(p ->> 'notes', '')), '')
  where id = v_id;
  perform private.audit(case when p_id is null then 'vehicle_added' else 'vehicle_updated' end, 'vehicle', v_id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('kind', v_kind, 'plate', v_plate, 'assigned_user_id', private.member_of(v_assigned), 'status', coalesce(p ->> 'status', 'active'))));
  return v_id;
end;
$$;

-- ------------------------------------------------------------ documents (the server stores the file first, then records it)
create or replace function public.admin_add_document(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_profile uuid := nullif(p ->> 'profile_id', '')::uuid;
  v_vehicle uuid := nullif(p ->> 'vehicle_id', '')::uuid;
begin
  perform private.require_permission('documents.manage');
  if (v_profile is null) = (v_vehicle is null) then perform private.app_error('invalid_request'); end if;
  if v_profile is not null and not exists (select 1 from public.profiles where id = v_profile) then perform private.app_error('not_found'); end if;
  if v_vehicle is not null and not exists (select 1 from public.vehicles where id = v_vehicle) then perform private.app_error('not_found'); end if;
  if (p ->> 'file_path') !~ ('^' || case when v_profile is not null then 'staff/' || v_profile else 'vehicle/' || v_vehicle end || '/') then
    perform private.app_error('invalid_request', 'path');
  end if;
  insert into public.documents (profile_id, vehicle_id, kind, title, file_path, mime, size_bytes, issued_on, expires_on, notes)
  values (v_profile, v_vehicle, p ->> 'kind', btrim(p ->> 'title'), p ->> 'file_path', p ->> 'mime', (p ->> 'size_bytes')::integer,
          nullif(p ->> 'issued_on', '')::date, nullif(p ->> 'expires_on', '')::date, nullif(btrim(coalesce(p ->> 'notes', '')), ''))
  returning id into v_id;
  perform private.audit('document_added', 'document', v_id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('kind', p ->> 'kind', 'for_user_id', private.member_of(v_profile),
      'plate', (select plate_number from public.vehicles where id = v_vehicle), 'expires_on', nullif(p ->> 'expires_on', ''))));
  return v_id;
end;
$$;

-- Removes the record; returns the file path for the server to delete from storage.
create or replace function public.admin_delete_document(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.documents;
begin
  perform private.require_permission('documents.manage');
  delete from public.documents where id = p_id returning * into d;
  if not found then perform private.app_error('not_found'); end if;
  perform private.audit('document_deleted', 'document', p_id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('kind', d.kind, 'title', d.title, 'for_user_id', private.member_of(d.profile_id),
      'plate', (select plate_number from public.vehicles where id = d.vehicle_id))));
  return d.file_path;
end;
$$;

-- ------------------------------------------------------------ what expires soon (page + alerts)
create or replace function private.expiring_items(p_days integer default 30)
returns table (item text, ref_id uuid, label text, who text, kind text, expires_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select 'document', d.id, d.title, coalesce(p.full_name, v.plate_number), d.kind, d.expires_on
    from public.documents d left join public.profiles p on p.id = d.profile_id left join public.vehicles v on v.id = d.vehicle_id
   where d.expires_on is not null and d.expires_on <= current_date + p_days
     and (p.id is null or (p.is_active and p.removed_at is null)) and (v.id is null or v.status <> 'retired')
  union all
  select 'vehicle_insurance', v.id, 'Insurance ' || coalesce(v.insurance_company, ''), v.plate_number, v.kind, v.insurance_expiry
    from public.vehicles v where v.status <> 'retired' and v.insurance_expiry <= current_date + p_days
  union all
  select 'vehicle_inspection', v.id, 'Annual inspection (Bolo)', v.plate_number, v.kind, v.inspection_expiry
    from public.vehicles v where v.status <> 'retired' and v.inspection_expiry <= current_date + p_days
  union all
  select 'courier_licence', p.id, 'Driving licence', p.full_name, cp.vehicle, cp.licence_expiry
    from public.courier_profiles cp join public.profiles p on p.id = cp.profile_id and p.is_active and p.removed_at is null
   where cp.licence_expiry <= current_date + p_days
  union all
  select 'courier_insurance', p.id, 'Vehicle insurance (courier''s own)', p.full_name, cp.vehicle, cp.insurance_expiry
    from public.courier_profiles cp join public.profiles p on p.id = cp.profile_id and p.is_active and p.removed_at is null
   where cp.insurance_expiry <= current_date + p_days
  order by 6
$$;
revoke all on function private.expiring_items(integer) from public;

create or replace function public.admin_expiring(p_days integer default 60)
returns table (item text, ref_id uuid, label text, who text, kind text, expires_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('documents.manage');
  return query select * from private.expiring_items(least(greatest(coalesce(p_days, 60), 1), 365));
end;
$$;

-- The delivery monitor's check also sends document / licence / insurance expiry alerts (once per item and date).
create or replace function private.delivery_monitor_scan()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select * from private.expiring_items(30) loop
    perform private.enqueue_notification('document_expiry', 'expiry:' || r.item || ':' || r.ref_id || ':' || r.expires_on,
      jsonb_strip_nulls(jsonb_build_object('item', r.item, 'label', r.label, 'who', r.who, 'kind', r.kind, 'expires_on', r.expires_on,
        'expired', r.expires_on < current_date, 'at', now())));
  end loop;
  if not coalesce((private.setting('delivery_monitor') ->> 'enabled')::boolean, true) then return 0; end if;
  for r in select * from private.delivery_overdue() loop
    perform private.enqueue_notification('delivery_alert', 'monitor:' || r.kind || ':' || r.order_id || ':' || r.since,
      jsonb_strip_nulls(jsonb_build_object('order_id', r.order_id, 'order_number', r.order_number, 'kind', r.kind, 'since', r.since,
        'hours', r.hours, 'courier_user_id', private.member_of(r.courier_id), 'city', r.city, 'shop', r.shop, 'at', now())));
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function private.telegram_group(p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event in ('security_event', 'security_alert', 'admin_action', 'security_test', 'promotion_alert', 'account_pending', 'delivery_pin_alert', 'document_expiry') then 'security'
    when p_event in ('low_stock', 'out_of_stock', 'stock_test') then 'stock'
    when p_event in ('receipt_record', 'receipts_test', 'excel_export') then 'receipts'
    when p_event in ('printing_document', 'printing_test') then 'printing'
    when p_event in ('support_ticket', 'support_reply', 'support_rating', 'support_test') then 'support'
    else 'orders'
  end
$$;

revoke all on function public.admin_save_vehicle(uuid, jsonb) from public, anon;
revoke all on function public.admin_add_document(jsonb) from public, anon;
revoke all on function public.admin_delete_document(uuid) from public, anon;
revoke all on function public.admin_expiring(integer) from public, anon;
grant execute on function public.admin_save_vehicle(uuid, jsonb) to authenticated;
grant execute on function public.admin_add_document(jsonb) to authenticated;
grant execute on function public.admin_delete_document(uuid) to authenticated;
grant execute on function public.admin_expiring(integer) to authenticated;
