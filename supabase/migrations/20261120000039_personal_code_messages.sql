-- =============================================================================
-- 0039 PERSONAL DISCOUNT CODES ARE SENT TO THE CUSTOMER
--   * Giving a personal code now emails the customer (English + Amharic) and sends a
--     phone notification if they turned them on — unless "notify" is unticked.
--   * admin_create_personal_code: create a unique one-customer code (e.g. MEKDES-7K2Q),
--     give it and send it in one step.
-- =============================================================================

create or replace function private.notify_promo_gift(p_promotion_id uuid, p_user uuid, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.enqueue_customer_email('customer_promo_gift', 'promo_gift:' || p.id || ':' || p_user, p_user, jsonb_build_object(
           'code', p.code, 'title_en', p.title_en, 'title_am', p.title_am, 'discount_type', p.discount_type,
           'discount_value', p.discount_value, 'min_order_etb', p.min_order_etb, 'ends_at', p.ends_at,
           'note', nullif(btrim(coalesce(p_note, '')), ''),
           'name', (select a.full_name from public.customer_accounts a where a.id = p_user)))
    from public.promotions p
   where p.id = p_promotion_id and p.code is not null
$$;

-- Same as before, plus notify (default on) and an optional personal note.
drop function if exists public.admin_assign_promotion(uuid, text[]);
create or replace function public.admin_assign_promotion(p_promotion_id uuid, p_emails text[], p_notify boolean default true, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_promo public.promotions;
  v_email text;
  v_user uuid;
  v_added text[] := '{}';
  v_already text[] := '{}';
  v_missing text[] := '{}';
begin
  perform private.require_permission('promotions.manage');
  if p_note is not null and char_length(p_note) > 300 then perform private.app_error('invalid_request', 'note'); end if;
  select * into v_promo from public.promotions where id = p_promotion_id;
  if not found then perform private.app_error('not_found'); end if;
  if not v_promo.restricted then perform private.app_error('invalid_request', 'promotion is not personal'); end if;
  if p_emails is null or cardinality(p_emails) = 0 or cardinality(p_emails) > 200 then
    perform private.app_error('invalid_request');
  end if;
  foreach v_email in array p_emails loop
    v_email := lower(btrim(v_email));
    continue when v_email = '';
    select u.id into v_user from auth.users u where lower(u.email) = v_email;
    if v_user is null then
      v_missing := v_missing || v_email;
      continue;
    end if;
    insert into public.promotion_customers (promotion_id, user_id) values (p_promotion_id, v_user)
    on conflict do nothing;
    if found then
      v_added := v_added || v_email;
      if coalesce(p_notify, true) and v_promo.is_active then perform private.notify_promo_gift(p_promotion_id, v_user, p_note); end if;
    else
      v_already := v_already || v_email;
    end if;
  end loop;
  return jsonb_build_object('added', to_jsonb(v_added), 'already', to_jsonb(v_already), 'not_found', to_jsonb(v_missing));
end;
$$;
revoke all on function public.admin_assign_promotion(uuid, text[], boolean, text) from public, anon;
grant execute on function public.admin_assign_promotion(uuid, text[], boolean, text) to authenticated;

-- Create a unique code for ONE customer, give it and (by default) send it.
create or replace function public.admin_create_personal_code(
  p_user_id uuid, p_discount_type text, p_value numeric, p_min_order numeric default 0, p_days integer default 30,
  p_note text default null, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text;
  v_prefix text;
  v_code text;
  v_id uuid;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I
  i int;
begin
  perform private.require_permission('promotions.manage');
  perform private.assert_confirmed_user(p_user_id);       -- a real, active customer (not staff)
  if p_discount_type not in ('percent', 'fixed') then perform private.app_error('invalid_request', 'type'); end if;
  if p_value is null or p_value <= 0 or (p_discount_type = 'percent' and p_value > 90) or (p_discount_type = 'fixed' and p_value > 100000)
     or p_value <> round(p_value, 2) then
    perform private.app_error('invalid_amount');
  end if;
  if coalesce(p_min_order, 0) < 0 or coalesce(p_min_order, 0) > 1000000 then perform private.app_error('invalid_amount'); end if;
  if p_days is null or p_days not between 1 and 365 then perform private.app_error('invalid_request', 'days'); end if;
  if p_note is not null and char_length(p_note) > 300 then perform private.app_error('invalid_request', 'note'); end if;

  select nullif(split_part(btrim(coalesce(a.full_name, '')), ' ', 1), '') into v_first from public.customer_accounts a where a.id = p_user_id;
  v_prefix := left(upper(regexp_replace(coalesce(v_first, ''), '[^A-Za-z]', '', 'g')), 10);
  if char_length(v_prefix) < 2 then v_prefix := 'GIFT'; end if;
  for attempt in 1..20 loop
    v_code := v_prefix || '-';
    for i in 1..4 loop v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.promotions where code = v_code);
  end loop;

  insert into public.promotions (title_en, title_am, description_en, description_am, code, discount_type, discount_value, min_order_etb,
                                 starts_at, ends_at, is_active, show_on_homepage, restricted, once_per_customer, max_redemptions)
  values ('Your personal discount', 'የእርስዎ የግል ቅናሽ',
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'A personal discount code just for you.'),
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'ለእርስዎ ብቻ የተሰጠ የግል የቅናሽ ኮድ።'),
          v_code, p_discount_type, p_value, coalesce(p_min_order, 0),
          now(), now() + make_interval(days => p_days), true, false, true, true, 1)
  returning id into v_id;
  insert into public.promotion_customers (promotion_id, user_id) values (v_id, p_user_id);
  if coalesce(p_notify, true) then perform private.notify_promo_gift(v_id, p_user_id, p_note); end if;
  return jsonb_build_object('promotion_id', v_id, 'code', v_code, 'ends_at', now() + make_interval(days => p_days));
end;
$$;
revoke all on function public.admin_create_personal_code(uuid, text, numeric, numeric, integer, text, boolean) from public, anon;
revoke all on function private.notify_promo_gift(uuid, uuid, text) from public;
grant execute on function public.admin_create_personal_code(uuid, text, numeric, numeric, integer, text, boolean) to authenticated;

-- Telegram copies of customer messages: show the discount code; product name only for back-in-stock.
create or replace function private.feed_notification_copy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'telegram' or new.status not in ('sent', 'dead') or old.status = new.status then return null; end if;
  if not private.feed_on('notifications') then return null; end if;
  perform private.enqueue_notification('notification_copy', 'feed:copy:' || new.id || ':' || new.status, jsonb_build_object(
    'channel', new.channel, 'event', new.event_type, 'status', new.status, 'attempts', new.attempts,
    'error', left(new.last_error, 300),
    'to', case when new.channel = 'archive' then private.setting('receipt_archive') ->> 'email'
               else (select u.email::text from auth.users u where u.id = new.recipient_user_id) end,
    'order_number', new.payload ->> 'order_number', 'job_number', new.payload ->> 'job_number',
    'number', coalesce(new.payload ->> 'number', new.payload ->> 'topup_number', new.payload ->> 'code'),
    'product', case when new.event_type = 'customer_back_in_stock' then new.payload ->> 'name' end,
    'amount_etb', coalesce(new.payload ->> 'total_etb', new.payload ->> 'amount_etb',
                           case when new.payload ->> 'discount_type' = 'fixed' then new.payload ->> 'discount_value' end),
    'note', left(new.payload ->> 'note', 200),
    'at', coalesce(new.sent_at, now())));
  return null;
end;
$$;
