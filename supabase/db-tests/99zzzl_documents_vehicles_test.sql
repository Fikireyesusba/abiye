-- 0076: vehicle register, employee / vehicle documents (private), expiry alerts. Plus a guard: every table has RLS.
\ir _helpers.sql

-- Guard for the whole database: no table without Row Level Security, nothing writable by visitors.
select pg_temp.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'every public table has Row Level Security on');
select pg_temp.ok(not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT'),
  'visitors (anon) can only read, never write, any table');
select pg_temp.ok((select not public from storage.buckets where id = 'staff-documents'), 'documents bucket is private');

select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_save_vehicle(null, '{"kind":"motorcycle"}')$$, 'invalid_request', 'motorcycle needs a plate number');
select public.admin_save_vehicle(null, '{"kind":"motorcycle","plate_number":"aa 3-12345","make":"Bajaj","model":"Boxer","insurance_company":"Nyala","insurance_expiry":"2000-01-10","inspection_expiry":"2099-01-01","assigned_to":"aaaaaaaa-0000-0000-0000-000000000004"}') as veh \gset
select pg_temp.ok((select plate_number = 'AA 3-12345' and assigned_to = :staff2 from public.vehicles where id = :'veh'::uuid), 'vehicle saved (plate upper-case, rider)');
select pg_temp.throws($$select public.admin_save_vehicle(null, '{"kind":"car","plate_number":"AA 3-12345"}')$$, 'invalid_request', 'plate numbers are unique');
select public.admin_add_document(jsonb_build_object('profile_id', :staff2, 'kind', 'driving_licence', 'title', 'Licence', 'file_path', 'staff/' || :staff2 || '/' || gen_random_uuid() || '.pdf',
  'mime', 'application/pdf', 'size_bytes', 1000, 'expires_on', (current_date + 10)::text)) as doc \gset
select pg_temp.throws(format($$select public.admin_add_document(%L)$$, jsonb_build_object('profile_id', :staff2, 'kind', 'cv', 'title', 'x',
  'file_path', 'staff/' || :staff || '/' || gen_random_uuid() || '.pdf', 'mime', 'application/pdf', 'size_bytes', 10)), 'invalid_request', 'a file must sit in that person''s folder');
select public.admin_add_document(jsonb_build_object('vehicle_id', :'veh', 'kind', 'libre', 'title', 'Libre', 'file_path', 'vehicle/' || :'veh' || '/' || gen_random_uuid() || '.jpg',
  'mime', 'image/jpeg', 'size_bytes', 2000));
select pg_temp.ok((select count(*) from public.documents) = 2, 'documents for an employee and a vehicle');
select pg_temp.ok((select count(*) from public.admin_expiring(30) where item in ('document', 'vehicle_insurance')) = 2, 'expiring: licence in 10 days, insurance expired');
reset role;

select private.delivery_monitor_scan();
select private.delivery_monitor_scan();
select pg_temp.ok((select count(*) from public.notifications_outbox where event_type = 'document_expiry') >= 2
                  and (select count(*) from public.notifications_outbox where event_type = 'document_expiry' and payload ->> 'label' = 'Licence') = 1
                  and private.telegram_group('document_expiry') = 'security',
  'expiry alerts to the security group, once per item');
select pg_temp.ok((select count(*) from public.audit_logs where action = 'document_added' and metadata::text like '%.pdf%') = 0, 'file paths are not in the Activity log');

-- access
select pg_temp.login(:manager);
select pg_temp.ok((select count(*) from public.documents) = 0, 'managers without documents.manage see no documents');
select pg_temp.throws($$select public.admin_expiring()$$, 'forbidden', 'managers cannot open the documents section');
reset role;
select pg_temp.login(:staff2);
select pg_temp.ok((select count(*) from public.vehicles) = 1 and (select count(*) from public.documents) = 0, 'a rider sees their own vehicle, not the documents');
reset role;
select pg_temp.login(:super);
select public.admin_delete_document(:'doc'::uuid);
select pg_temp.ok((select count(*) from public.documents where id = :'doc'::uuid) = 0, 'document deleted (the server removes the file)');
reset role;
rollback;
