-- One open session per account; reviews one at a time; push device follows the latest account
\ir _helpers.sql
create function pg_temp.login_s(p_user uuid, p_session uuid, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_session)::text, false);
  set role authenticated;
end $$;
insert into auth.sessions (id, user_id) values ('51000000-0000-0000-0000-000000000001', :manager), ('51000000-0000-0000-0000-000000000002', :customer),
  ('51000000-0000-0000-0000-000000000003', :customer2);

-- staff: open session works, ended session loses every permission at once
select pg_temp.login_s(:manager, '51000000-0000-0000-0000-000000000001');
select pg_temp.ok(private.has_permission('orders.view_all') and public.session_is_current(), 'open session: manager has access');
reset role;
delete from auth.sessions where id = '51000000-0000-0000-0000-000000000001';  -- signed in on another device
select pg_temp.login_s(:manager, '51000000-0000-0000-0000-000000000001');
select pg_temp.ok(not private.has_permission('orders.view_all') and not public.session_is_current(), 'ended session: no access even with an unexpired token');
select pg_temp.ok((select count(*) from public.orders) = 0, 'ended session reads no orders');
reset role;

-- customers
select pg_temp.login_s(:customer, '51000000-0000-0000-0000-000000000002');
select pg_temp.ok(private.is_active_customer(), 'open customer session');
select public.claim_push_device('https://fcm.googleapis.com/fcm/send/shared-device', repeat('B', 87), repeat('a', 22), 'am');
reset role;
select pg_temp.ok((select user_id from public.push_subscriptions where endpoint like '%shared-device') = :customer, 'device notifies customer 1');
select pg_temp.login_s(:customer2, '51000000-0000-0000-0000-000000000003');
select public.claim_push_device('https://fcm.googleapis.com/fcm/send/shared-device', repeat('B', 87), repeat('a', 22), 'en');
reset role;
select pg_temp.ok((select count(*) from public.push_subscriptions where endpoint like '%shared-device') = 1
  and (select user_id from public.push_subscriptions where endpoint like '%shared-device') = :customer2, 'same device signed in with account 2: only account 2 is notified');
select pg_temp.login_s(:customer2, '51000000-0000-0000-0000-000000000003');
select pg_temp.throws($$select public.claim_push_device('https://evil.example/collect', repeat('B', 87), repeat('a', 22))$$, '%push_subscriptions_endpoint_check%', 'only real push services');
reset role;
delete from auth.sessions where id = '51000000-0000-0000-0000-000000000002';
select pg_temp.login_s(:customer, '51000000-0000-0000-0000-000000000002');
select pg_temp.ok(not private.is_active_customer(), 'ended customer session cannot act');
select pg_temp.throws($$select public.claim_push_device('https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22))$$, 'login_required', 'ended session cannot take the device');
reset role;
set role anon;
select pg_temp.throws($$select public.claim_push_device('https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22))$$, '%permission denied%', 'visitors cannot');
reset role;

-- security reviews: one at a time
select pg_temp.login(:super);
select pg_temp.throws($$select public.admin_mark_security_reviewed('email', array['a@example.com', 'b@example.com'])$$, 'invalid_request', 'no bulk review');
select pg_temp.ok(public.admin_mark_security_reviewed('email', array['a@example.com'], 'checked') = 1, 'single review works');
reset role;
