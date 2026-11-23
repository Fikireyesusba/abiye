-- Customer phone notifications (Web Push)
\ir _helpers.sql

select pg_temp.login(:customer);
insert into public.push_subscriptions (endpoint, p256dh, auth, locale)
values ('https://fcm.googleapis.com/fcm/send/abc123', repeat('B', 87), repeat('a', 22), 'am');
select pg_temp.ok((select user_id from public.push_subscriptions) = :customer, 'device saved for the signed-in customer');
select pg_temp.throws($$insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://evil.example/collect', repeat('B', 87), repeat('a', 22))$$,
  '%check constraint%', 'only real push services are accepted (no server-side requests elsewhere)');
select pg_temp.throws($$insert into public.push_subscriptions (endpoint, p256dh, auth) values ('http://fcm.googleapis.com/x', repeat('B', 87), repeat('a', 22))$$,
  '%check constraint%', 'https only');
select pg_temp.throws($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('cccccccc-0000-0000-0000-000000000002', 'https://fcm.googleapis.com/fcm/send/x2', repeat('B', 87), repeat('a', 22))$$,
  '%permission denied%', 'cannot register a device for someone else');
reset role;
select pg_temp.login(:customer2);
select pg_temp.ok((select count(*) from public.push_subscriptions) = 0, 'customers see only their own devices');
reset role;

-- events queue a push next to the email (only for customers with a device)
set role service_role;
select public.create_order_for_user(:customer, pg_temp.order_payload('e7000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1))));
select public.create_order_for_user(:customer2, pg_temp.order_payload('e7000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1))));
reset role;
-- payment accepted → the order exists → notifications
update public.orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now()
 where idempotency_key in ('e7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'push' and event_type = 'customer_order_confirmed' and recipient_user_id = :customer) = 1,
  'customer with a device: phone notification queued');
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'push' and recipient_user_id = :customer2) = 0,
  'customer without a device: no phone notification');
select pg_temp.ok((select count(*) from public.notifications_outbox where channel = 'email' and event_type = 'customer_order_confirmed') = 2, 'emails unaffected');

set role service_role;
select pg_temp.ok((select locale from public.push_targets(:customer)) = 'am', 'worker reads the devices with their language');
select pg_temp.ok((select bool_and(channel = 'push') from public.claim_outbox('push', 50)), 'push worker claims only push rows');
reset role;
select pg_temp.login(:customer);
select pg_temp.throws($$select * from public.push_targets('cccccccc-0000-0000-0000-000000000001')$$, '%permission denied%', 'only the server reads devices');
delete from public.push_subscriptions;
reset role;
select pg_temp.ok((select count(*) from public.push_subscriptions where user_id = :customer) = 0, 'customers can remove their devices');

-- device limit
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
select :customer, 'https://fcm.googleapis.com/fcm/send/n' || g, repeat('B', 87), repeat('a', 22), now() - make_interval(mins => 20 - g)
  from generate_series(1, 12) g;
select pg_temp.ok((select count(*) from public.push_subscriptions where user_id = :customer) = 10, 'at most 10 devices per customer (oldest dropped)');
rollback;
