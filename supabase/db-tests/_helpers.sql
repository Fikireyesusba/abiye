-- Shared helpers for SQL tests (pg_temp => session-local, never persisted)
\set QUIET on
begin;
set client_min_messages = notice;
\o /dev/null

create function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL - %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

create function pg_temp.throws(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then
      raise exception 'FAIL - % (expected error like "%", got "%")', p_msg, p_like, sqlerrm;
    end if;
    raise notice 'ok - %', p_msg;
    return;
  end;
  raise exception 'FAIL - % (statement succeeded, expected "%")', p_msg, p_like;
end $$;

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
  set role authenticated;
end $$;

create function pg_temp.hash(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- Build a checkout payload exactly as the Next.js server will.
create function pg_temp.order_payload(p_key uuid, p_items jsonb, p_method text default 'delivery',
                                      p_phone text default '+251911223344') returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotency_key', p_key,
    'access_token_hash', pg_temp.hash('tok-' || p_key),
    'tracking_code_hash', pg_temp.hash('trk-' || p_key),
    'locale', 'am',
    'customer', jsonb_build_object('full_name', 'Test Customer', 'phone', p_phone),
    'fulfillment', jsonb_build_object('method', p_method,
        'delivery_zone_id', '40000000-0000-0000-0000-000000000001',
        'address_line', 'Bole, House 123', 'instructions', 'Call on arrival'),
    'items', p_items)
$$;

create function pg_temp.job_payload(p_id uuid, p_pages integer, p_size text default 'A4') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'access_token_hash', pg_temp.hash('job-' || p_id),
    'customer', jsonb_build_object('full_name', 'Print Customer', 'phone', '+251933445566'),
    'color_mode', 'bw', 'paper_size', p_size, 'sides', 'single', 'copies', 2, 'fulfillment_method', 'pickup',
    'files', jsonb_build_array(jsonb_build_object('path', 'jobs/' || p_id || '/doc.pdf', 'original_name', 'thesis.pdf',
      'mime', 'application/pdf', 'size', 2048, 'sha256', repeat('d', 64), 'page_count', p_pages)))
$$;

-- Test users
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'super@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'staff@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'staff2@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'random-signup@test.local');
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001', 'customer@test.local', now(), '{"full_name":"Test Customer","accepted_terms":"true"}'),
  ('cccccccc-0000-0000-0000-000000000002', 'customer2@test.local', now(), '{}'),
  ('cccccccc-0000-0000-0000-000000000003', 'unconfirmed@test.local', null, '{}');
-- Direct insert (not bootstrap_super_admin) so the suite also runs on a database
-- that already has a real Super Admin. Bootstrap itself is tested in 10_*.
insert into public.profiles (id, full_name, role_id)
select u.id, u.email, r.id from (values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Test Super', 'super_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager@test.local', 'manager'),
  ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'staff@test.local', 'staff'),
  ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'staff2@test.local', 'staff')) u(id, email, role)
join public.admin_roles r on r.key = u.role;

\set super   '''aaaaaaaa-0000-0000-0000-000000000001'''
\set manager '''aaaaaaaa-0000-0000-0000-000000000002'''
\set staff   '''aaaaaaaa-0000-0000-0000-000000000003'''
\set staff2  '''aaaaaaaa-0000-0000-0000-000000000004'''
\set outsider '''aaaaaaaa-0000-0000-0000-000000000005'''
\set customer '''cccccccc-0000-0000-0000-000000000001'''
\set customer2 '''cccccccc-0000-0000-0000-000000000002'''
\set perfume '''20000000-0000-0000-0000-000000000001'''
\set charger '''20000000-0000-0000-0000-000000000007'''
\set hairoil '''20000000-0000-0000-0000-000000000005'''
\set draft   '''20000000-0000-0000-0000-000000000011'''
\o /dev/null
