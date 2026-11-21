-- =============================================================================
-- 0048 MANAGE SERVICES
-- Super Admin switches customer services on / off (Admin → Manage services).
-- A switched-off service is refused by the database (not only hidden on the
-- website): ordering / paying for products, printing (upload and payment),
-- wallet (top-ups and paying with the balance), writing reviews. New sign-ups
-- are switched off on the website. Customers see "temporarily unavailable".
-- Delivery / pickup keep their own switches under Settings → Delivery.
-- =============================================================================
insert into public.website_settings (key, value, is_public)
values ('services', '{"shop": true, "printing": true, "wallet": true, "reviews": true, "signup": true, "note": {"en": "", "am": ""}}', true)
on conflict (key) do nothing;

create or replace function private.service_on(p_service text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.setting('services') ->> p_service)::boolean, true)
$$;
grant execute on function private.service_on(text) to authenticated, service_role;

-- Order lines: products need the shop, printing lines need printing.
create or replace function private.order_item_service_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_type = 'product' and not private.service_on('shop') then perform private.app_error('service_unavailable', 'shop'); end if;
  if new.item_type = 'printing' and not private.service_on('printing') then perform private.app_error('service_unavailable', 'printing'); end if;
  return new;
end;
$$;
drop trigger if exists order_item_service_check on public.order_items;
create trigger order_item_service_check before insert on public.order_items
  for each row execute function private.order_item_service_check();

-- Paying with the balance needs the wallet.
create or replace function private.order_wallet_service_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_method = 'wallet' and (tg_op = 'INSERT' or old.payment_method is distinct from 'wallet') and not private.service_on('wallet') then
    perform private.app_error('service_unavailable', 'wallet');
  end if;
  return new;
end;
$$;
drop trigger if exists order_wallet_service_check on public.orders;
create trigger order_wallet_service_check before insert or update of payment_method on public.orders
  for each row execute function private.order_wallet_service_check();

-- Uploading a payment receipt: refused while the order's service is off.
create or replace function private.payment_service_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.service_on('shop') and exists (select 1 from public.order_items i where i.order_id = new.order_id and i.item_type = 'product') then
    perform private.app_error('service_unavailable', 'shop');
  end if;
  if not private.service_on('printing') and exists (select 1 from public.order_items i where i.order_id = new.order_id and i.item_type = 'printing') then
    perform private.app_error('service_unavailable', 'printing');
  end if;
  return new;
end;
$$;
drop trigger if exists payment_service_check on public.payment_submissions;
create trigger payment_service_check before insert on public.payment_submissions
  for each row execute function private.payment_service_check();

-- Printing: no new jobs (uploads).
create or replace function private.printing_service_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.service_on('printing') then perform private.app_error('service_unavailable', 'printing'); end if;
  return new;
end;
$$;
drop trigger if exists printing_service_check on public.printing_jobs;
create trigger printing_service_check before insert on public.printing_jobs
  for each row execute function private.printing_service_check();

-- Wallet: no new top-ups.
create or replace function private.topup_service_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.service_on('wallet') then perform private.app_error('service_unavailable', 'wallet'); end if;
  return new;
end;
$$;
drop trigger if exists topup_service_check on public.wallet_topups;
create trigger topup_service_check before insert on public.wallet_topups
  for each row execute function private.topup_service_check();

-- Reviews: no new reviews.
create or replace function private.review_service_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.service_on('reviews') then perform private.app_error('service_unavailable', 'reviews'); end if;
  return new;
end;
$$;
drop trigger if exists review_service_check on public.product_reviews;
create trigger review_service_check before insert on public.product_reviews
  for each row execute function private.review_service_check();
