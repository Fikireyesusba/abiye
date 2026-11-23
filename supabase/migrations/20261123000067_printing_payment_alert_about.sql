-- 0067:
--   * A printing order whose payment receipt was attached is always announced in the orders & payments
--     Telegram group ("waiting for verification"), whatever the "pending payment alerts" switch says —
--     like wallet top-ups. Product orders still follow the switch. The documents go to the printing
--     group only after the payment is approved (unchanged).
--   * "About us" page text, edited in Admin → Settings → About us.

create or replace function private.telegram_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel <> 'telegram' then return new; end if;
  if new.event_type in ('order_placed', 'order_status', 'printing_status', 'order_cancelled', 'payment_rejected', 'notification_copy', 'printing_request') then
    return null;
  end if;
  if new.event_type in ('new_order', 'payment_resubmitted') then
    -- Printing orders are marked (own title in Telegram) and always announced.
    if exists (select 1 from public.order_items i
                where i.order_id = case when coalesce(new.payload ->> 'order_id', '') ~ '^[0-9a-fA-F-]{36}$' then (new.payload ->> 'order_id')::uuid end
                  and i.item_type = 'printing') then
      new.payload := new.payload || jsonb_build_object('printing', true);
    elsif not private.feed_on('pending_payments') then
      return null;
    end if;
  end if;
  return new;
end;
$$;

insert into public.website_settings (key, value, is_public)
values ('about', jsonb_build_object(
  'title', jsonb_build_object('en', '', 'am', ''),
  'body', jsonb_build_object('en', '', 'am', ''),
  'show_services', true, 'show_why_us', true), true)
on conflict (key) do nothing;
