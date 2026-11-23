-- =============================================================================
-- 0064 PROMOTION ALERTS + EXCEL COPIES THROUGH THE QUEUE
--   * Every promotion change is a security alert in Telegram: created, changed, switched on / off,
--     revoked (with the reason), brought back, deleted, code given to / removed from a customer —
--     and "code used" when an order with a code is paid (User ID, order, original price, discount, price paid).
--   * Every Excel download is copied, as the file with an alert, to the receipts group through the
--     notification queue (retried like receipts; failures show under Notifications). The file waits in
--     the private excel-exports bucket and is removed once Telegram has it.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('excel-exports', 'excel-exports', false, 52428800, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- No storage policies: only the server (secret key) reads or writes this bucket.

create or replace function private.telegram_group(p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event in ('security_event', 'security_alert', 'admin_action', 'security_test', 'promotion_alert') then 'security'
    when p_event in ('low_stock', 'out_of_stock', 'stock_test') then 'stock'
    when p_event in ('receipt_record', 'receipts_test', 'excel_export') then 'receipts'
    when p_event in ('printing_document', 'printing_test') then 'printing'
    when p_event in ('support_ticket', 'support_reply', 'support_rating', 'support_test') then 'support'
    else 'orders'
  end
$$;

-- ------------------------------------------------------------ Excel copies
create or replace function public.queue_excel_copy(p_path text, p_file_name text, p_title text, p_rows integer default null, p_by uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_path, '') !~ '^[0-9a-f-]{36}\.xlsx$' or coalesce(p_file_name, '') !~ '^[A-Za-z0-9._-]{1,120}$'
     or char_length(coalesce(p_title, '')) not between 1 and 120 then
    perform private.app_error('invalid_request');
  end if;
  perform private.enqueue_notification('excel_export', 'excel:' || p_path, jsonb_strip_nulls(jsonb_build_object(
    'title', p_title, 'file_name', p_file_name, 'rows', p_rows, 'by_user_id', private.member_of(p_by), 'at', now())),
    'excel-exports', p_path);
end;
$$;
revoke all on function public.queue_excel_copy(text, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.queue_excel_copy(text, text, text, integer, uuid) to service_role;

-- ------------------------------------------------------------ Promotion alerts
create or replace function private.promo_summary(p public.promotions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'promotion_id', p.id, 'title', p.title_en, 'code', p.code::text,
    'discount', case when p.discount_type = 'percent' then trim(to_char(p.discount_value, 'FM990.##')) || '% off'
                     else trim(to_char(p.discount_value, 'FM999999990.##')) || ' ETB off' end,
    'audience', case when p.restricted then 'Selected customers' else 'Every customer' end,
    'applies_to', coalesce((select 'Product: ' || pr.name_en from public.products pr where pr.id = p.product_id),
                           (select 'Category: ' || c.name_en from public.categories c where c.id = p.category_id), 'All products'),
    'min_order_etb', nullif(p.min_order_etb, 0), 'usage_limit', p.max_redemptions,
    'starts_at', p.starts_at, 'ends_at', p.ends_at, 'active', p.is_active, 'homepage', nullif(p.show_on_homepage, false)))
$$;

create or replace function private.promotion_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change text;
  v_fields text[] := '{}';
  v_p public.promotions := coalesce(new, old);
begin
  if tg_op = 'INSERT' then
    v_change := 'created';
  elsif tg_op = 'DELETE' then
    v_change := 'deleted';
  elsif old.revoked_at is null and new.revoked_at is not null then
    v_change := 'revoked';
  elsif old.revoked_at is not null and new.revoked_at is null then
    v_change := 'restored';
  else
    if old.title_en is distinct from new.title_en then v_fields := array_append(v_fields, 'title'::text); end if;
    if old.code is distinct from new.code then v_fields := array_append(v_fields, 'code'::text); end if;
    if old.discount_type is distinct from new.discount_type or old.discount_value is distinct from new.discount_value then v_fields := array_append(v_fields, 'discount'::text); end if;
    if old.restricted is distinct from new.restricted then v_fields := array_append(v_fields, 'who can use it'::text); end if;
    if old.product_id is distinct from new.product_id or old.category_id is distinct from new.category_id then v_fields := array_append(v_fields, 'applies to'::text); end if;
    if old.min_order_etb is distinct from new.min_order_etb then v_fields := array_append(v_fields, 'minimum order'::text); end if;
    if old.max_redemptions is distinct from new.max_redemptions then v_fields := array_append(v_fields, 'usage limit'::text); end if;
    if old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at then v_fields := array_append(v_fields, 'dates'::text); end if;
    if old.show_on_homepage is distinct from new.show_on_homepage then v_fields := array_append(v_fields, 'homepage'::text); end if;
    if old.description_en is distinct from new.description_en then v_fields := array_append(v_fields, 'description'::text); end if;
    if old.is_active is distinct from new.is_active then
      v_change := case when new.is_active then 'switched_on' else 'switched_off' end;
    elsif cardinality(v_fields) > 0 then
      v_change := 'changed';
    else
      return null; -- nothing a person would notice (e.g. only updated_at)
    end if;
  end if;
  perform private.enqueue_notification('promotion_alert', 'promo:' || v_p.id || ':' || v_change || ':' || txid_current() || ':' || clock_timestamp(),
    private.promo_summary(v_p) || jsonb_strip_nulls(jsonb_build_object(
      'change', v_change,
      'changed', case when cardinality(v_fields) > 0 then array_to_string(v_fields, ', ') end,
      'reason', case when v_change = 'revoked' then v_p.revoked_reason end,
      'by_user_id', private.member_of(auth.uid()),
      'at', now())));
  return null;
end;
$$;
create trigger promotions_telegram_alert after insert or update or delete on public.promotions
  for each row execute function private.promotion_alert();

create or replace function private.promotion_customer_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.promotion_customers := coalesce(new, old);
  v public.promotions;
begin
  select * into v from public.promotions where id = r.promotion_id;
  if not found then return null; end if;  -- the promotion itself is being deleted
  perform private.enqueue_notification('promotion_alert', 'promo:' || r.promotion_id || ':' || r.user_id || ':' || tg_op || ':' || clock_timestamp(),
    private.promo_summary(v) || jsonb_strip_nulls(jsonb_build_object(
      'change', case when tg_op = 'INSERT' then 'given' else 'removed' end,
      'user_id', private.member_of(r.user_id),
      'reason', case when tg_op = 'DELETE' then nullif(current_setting('app.promo_reason', true), '') end,
      'by_user_id', private.member_of(auth.uid()),
      'at', now())));
  return null;
end;
$$;
create trigger promotion_customers_telegram_alert after insert or delete on public.promotion_customers
  for each row execute function private.promotion_customer_alert();

-- Code used: the order's payment was approved (or paid with the balance).
create or replace function private.promotion_redeemed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.promotions;
begin
  if new.promotion_id is null or new.user_id is null then return new; end if;
  if new.status in ('expired', 'cancelled') then
    update public.promotion_customers set used_at = null, used_order_id = null
     where used_order_id = new.id;
  elsif new.payment_status = 'verified' then
    update public.promotion_customers set used_at = coalesce(used_at, now()), used_order_id = new.id
     where promotion_id = new.promotion_id and user_id = new.user_id and used_order_id is distinct from new.id;
    select * into v from public.promotions where id = new.promotion_id;
    if found then
      perform private.enqueue_notification('promotion_alert', 'promo_used:' || new.id,
        private.promo_summary(v) || jsonb_strip_nulls(jsonb_build_object(
          'change', 'used', 'user_id', private.member_of(new.user_id), 'order_id', new.id, 'order_number', new.order_number,
          'original_etb', new.subtotal_etb + new.delivery_fee_etb, 'discount_etb', new.discount_etb, 'total_etb', new.total_etb,
          'payment_method', new.payment_method, 'at', now())));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.promo_summary(public.promotions) from public;
revoke all on function private.promotion_alert() from public;
revoke all on function private.promotion_customer_alert() from public;
