-- =============================================================================
-- 0041 TELEGRAM: ORDERS GROUP ONLY FOR APPROVALS; STOCK AND RECEIPTS GROUPS
--   * Orders & payments group: by default only what needs you — receipts to verify,
--     top-ups to verify, printing requests to quote. Order / printing progress, payment
--     decisions, cancellations, balance payments and customer-message copies are
--     switches (off by default).
--   * Stock group (TELEGRAM_STOCK_*): low stock / sold out, instead of staff emails.
--   * Receipts group (TELEGRAM_RECEIPTS_*): every verified / rejected receipt file
--     with its details (in addition to the receipt-archive email).
-- =============================================================================

-- Switch defaults (missing keys): order_progress, notifications (copies) off; the rest on.
create or replace function private.feed_on(p_part text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.setting('telegram_feed') ->> p_part)::boolean,
                  p_part not in ('order_progress', 'notifications'))
$$;
-- The owner asked for approvals only: switch copies of customer messages off.
update public.website_settings set value = value || '{"notifications": false, "order_progress": false}'::jsonb
 where key = 'telegram_feed';

drop function if exists public.admin_set_telegram_feed(boolean, boolean, boolean);
create or replace function public.admin_set_telegram_feed(p_security boolean, p_admin boolean, p_notifications boolean,
                                                          p_order_progress boolean default false, p_printing_requests boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := jsonb_build_object('security', coalesce(p_security, true), 'admin', coalesce(p_admin, true),
                                'notifications', coalesce(p_notifications, false), 'order_progress', coalesce(p_order_progress, false),
                                'printing_requests', coalesce(p_printing_requests, true));
begin
  perform private.require_permission('settings.manage');
  insert into public.website_settings (key, value, is_public, updated_by) values ('telegram_feed', v, false, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = false, updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.admin_set_telegram_feed(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_set_telegram_feed(boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.admin_telegram_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return jsonb_build_object('security', private.feed_on('security'), 'admin', private.feed_on('admin'),
                            'notifications', private.feed_on('notifications'), 'order_progress', private.feed_on('order_progress'),
                            'printing_requests', private.feed_on('printing_requests'));
end;
$$;

-- Telegram messages that are switched off are never queued.
create or replace function private.telegram_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel <> 'telegram' then return new; end if;
  if new.event_type in ('order_placed', 'order_status', 'printing_status', 'order_cancelled', 'payment_verified', 'payment_rejected', 'wallet_order_paid')
     and not private.feed_on('order_progress') then
    return null;
  end if;
  if new.event_type = 'printing_request' and not private.feed_on('printing_requests') then return null; end if;
  return new;
end;
$$;
drop trigger if exists notifications_outbox_telegram_filter on public.notifications_outbox;
create trigger notifications_outbox_telegram_filter before insert on public.notifications_outbox
  for each row execute function private.telegram_filter();

-- Which group a Telegram message belongs to.
create or replace function private.telegram_group(p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event in ('security_event', 'security_alert', 'admin_action', 'security_test') then 'security'
    when p_event in ('low_stock', 'out_of_stock', 'stock_test') then 'stock'
    when p_event in ('receipt_record', 'receipts_test') then 'receipts'
    else 'orders'
  end
$$;

-- Worker (service_role): claim due rows of the given groups (stock falls back to the orders bot if it has none).
create or replace function public.claim_telegram_groups(p_groups text[], p_limit integer default 10)
returns setof public.notifications_outbox
language sql
security definer
set search_path = ''
as $$
  update public.notifications_outbox o
     set status = 'processing', attempts = o.attempts + 1, locked_until = now() + interval '2 minutes'
   where o.id in (
     select id from public.notifications_outbox
      where channel = 'telegram'
        and private.telegram_group(event_type) = any(p_groups)
        and ((status in ('pending', 'failed') and next_attempt_at <= now())
          or (status = 'processing' and locked_until < now()))
      order by id
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked)
  returning o.*;
$$;
revoke all on function public.claim_telegram_groups(text[], integer) from public, anon, authenticated;
grant execute on function public.claim_telegram_groups(text[], integer) to service_role;

-- Stock: Telegram only (no more staff emails).
create or replace function private.stock_level_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_key text := new.id || ':' || txid_current();
  v_payload jsonb;
begin
  if not new.track_inventory then return null; end if;
  v_payload := jsonb_build_object('product_id', new.id, 'name', new.name_en, 'name_am', new.name_am, 'sku', new.sku, 'slug', new.slug,
                                  'stock', new.stock_quantity, 'threshold', new.low_stock_threshold);
  if new.status = 'active' then
    if new.stock_quantity = 0 and old.stock_quantity > 0 then v_event := 'out_of_stock';
    elsif new.stock_quantity <= new.low_stock_threshold and old.stock_quantity > new.low_stock_threshold then v_event := 'low_stock';
    end if;
    if v_event is not null then
      perform private.enqueue_notification(v_event, v_event || ':' || v_key, v_payload);
    end if;
  end if;
  if new.status = 'active' and new.stock_quantity > 0 and old.stock_quantity = 0 then
    perform private.enqueue_customer_email('customer_back_in_stock', 'back_in_stock:' || a.id, a.user_id, v_payload)
       from public.stock_alerts a
      where a.product_id = new.id and a.notified_at is null and private.is_active_user(a.user_id);
    update public.stock_alerts set notified_at = now() where product_id = new.id and notified_at is null;
  end if;
  return null;
end;
$$;

-- Receipts group: the receipt file with the decision, for every verified / rejected payment or top-up.
create or replace function private.telegram_receipt_record(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'payment' then
    insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, attachment_bucket, attachment_path, max_attempts)
    select 'telegram', 'receipt_record', 'tg_receipt:payment:' || s.id || ':' || s.status,
           jsonb_build_object('kind', 'order_payment', 'result', s.status, 'number', o.order_number, 'order_id', o.id,
             'amount_etb', s.amount_expected_etb, 'reference', s.transaction_reference, 'customer_name', o.customer_name,
             'customer_phone', o.customer_phone, 'bank_name', o.bank_snapshot ->> 'bank_name', 'account_number', o.bank_snapshot ->> 'account_number',
             'decided_at', s.reviewed_at, 'decided_by', private.actor_name(s.reviewed_by), 'reason', s.review_note),
           'payment-receipts', s.receipt_path, 10
      from public.payment_submissions s join public.orders o on o.id = s.order_id
     where s.id = p_id
    on conflict (dedupe_key) do nothing;
  else
    insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, attachment_bucket, attachment_path, max_attempts)
    select 'telegram', 'receipt_record', 'tg_receipt:topup:' || t.id || ':' || t.status,
           jsonb_build_object('kind', 'wallet_topup', 'result', t.status, 'number', t.topup_number,
             'amount_etb', t.amount_etb, 'reference', t.transaction_reference, 'customer_name', a.full_name, 'customer_phone', a.phone,
             'bank_name', t.bank_snapshot ->> 'bank_name', 'account_number', t.bank_snapshot ->> 'account_number',
             'decided_at', t.reviewed_at, 'decided_by', private.actor_name(t.reviewed_by), 'reason', t.review_note),
           'payment-receipts', t.receipt_path, 10
      from public.wallet_topups t left join public.customer_accounts a on a.id = t.user_id
     where t.id = p_id
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

create or replace function private.archive_on_payment_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text in ('verified', 'rejected') and old.status::text is distinct from new.status::text then
    if tg_table_name = 'payment_submissions' then
      perform private.archive_payment_receipt(new.id);
      perform private.telegram_receipt_record('payment', new.id);
    else
      perform private.archive_topup_receipt(new.id);
      perform private.telegram_receipt_record('topup', new.id);
    end if;
  end if;
  return null;
end;
$$;

-- Test buttons for the stock and receipts groups.
create or replace function public.admin_queue_group_test(p_group text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  if p_group not in ('stock', 'receipts') then perform private.app_error('invalid_request'); end if;
  perform private.enqueue_notification(p_group || '_test', p_group || '_test:' || gen_random_uuid(),
    jsonb_build_object('requested_by', private.actor_name(auth.uid()), 'requested_at', now()));
end;
$$;
revoke all on function public.admin_queue_group_test(text) from public, anon;
grant execute on function public.admin_queue_group_test(text) to authenticated;

-- Messages for a group that was never set up are dropped after 2 days.
create or replace function public.purge_stale_telegram_feed()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.notifications_outbox
   where channel = 'telegram' and status in ('pending', 'failed', 'dead')
     and event_type in ('security_event', 'security_alert', 'admin_action', 'notification_copy', 'receipt_record', 'stock_test', 'receipts_test')
     and created_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
