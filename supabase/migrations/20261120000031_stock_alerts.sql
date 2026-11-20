-- =============================================================================
-- 0031 STOCK ALERTS
--  * Staff: a Telegram + email alert when an active product reaches its low-stock level
--    and when it sells out (once per crossing, queued with the stock change).
--  * Customers: "Notify me when available" on out-of-stock products; email + phone
--    notification when it is back in stock (once per request).
-- =============================================================================

create table public.stock_alerts (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create unique index stock_alerts_open_uq on public.stock_alerts(product_id, user_id) where notified_at is null;
create index stock_alerts_user_idx on public.stock_alerts(user_id, created_at desc);

alter table public.stock_alerts enable row level security;
revoke all on public.stock_alerts from anon, authenticated;
grant select on public.stock_alerts to authenticated;
-- Customers see their own requests; staff who manage stock see all (counts per product).
create policy stock_alerts_own_read on public.stock_alerts for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('inventory.manage')));
-- Changes only through the functions below.

-- Customer: ask to be told when an out-of-stock product is available again.
create or replace function public.request_stock_alert(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.products;
begin
  perform private.assert_confirmed_user(v_uid); -- signed in, confirmed, active, not staff
  select * into v_p from public.products where id = p_product_id and status = 'active';
  if not found then perform private.app_error('not_found'); end if;
  if not v_p.track_inventory or v_p.stock_quantity > 0 then perform private.app_error('invalid_request', 'in_stock'); end if;
  if (select count(*) from public.stock_alerts where user_id = v_uid and notified_at is null) >= 50 then
    perform private.app_error('rate_limited');
  end if;
  insert into public.stock_alerts (product_id, user_id) values (p_product_id, v_uid)
  on conflict (product_id, user_id) where notified_at is null do nothing;
end;
$$;

create or replace function public.cancel_stock_alert(p_product_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.stock_alerts where product_id = p_product_id and user_id = (select auth.uid()) and notified_at is null;
$$;

-- Staff who should get stock emails: active staff whose role can manage inventory.
create or replace function private.stock_alert_recipients()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id and rp.permission_key = 'inventory.manage'
   where p.is_active
$$;

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

  -- Staff: crossed down into "low" or sold out (active products only).
  if new.status = 'active' then
    if new.stock_quantity = 0 and old.stock_quantity > 0 then v_event := 'out_of_stock';
    elsif new.stock_quantity <= new.low_stock_threshold and old.stock_quantity > new.low_stock_threshold then v_event := 'low_stock';
    end if;
    if v_event is not null then
      perform private.enqueue_notification(v_event, v_event || ':' || v_key, v_payload);
      insert into public.notifications_outbox (channel, event_type, dedupe_key, payload, recipient_user_id, max_attempts)
      select 'email', 'staff_' || v_event, 'staff_' || v_event || ':' || v_key || ':' || r, v_payload, r, 6
        from private.stock_alert_recipients() r
      on conflict (dedupe_key) do nothing;
    end if;
  end if;

  -- Customers: back in stock.
  if new.status = 'active' and new.stock_quantity > 0 and old.stock_quantity = 0 then
    perform private.enqueue_customer_email('customer_back_in_stock', 'back_in_stock:' || a.id, a.user_id, v_payload)
       from public.stock_alerts a
      where a.product_id = new.id and a.notified_at is null and private.is_active_user(a.user_id);
    update public.stock_alerts set notified_at = now() where product_id = new.id and notified_at is null;
  end if;
  return null;
end;
$$;
create trigger products_stock_alerts after update of stock_quantity, status on public.products
  for each row when (old.stock_quantity is distinct from new.stock_quantity or old.status is distinct from new.status)
  execute function private.stock_level_changed();

-- Admin menu badge / overview.
create or replace function public.admin_low_stock_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.has_permission('inventory.manage') then
    (select count(*)::int from public.products where track_inventory and status = 'active' and stock_quantity <= low_stock_threshold)
  else 0 end
$$;

revoke all on function public.request_stock_alert(uuid) from public, anon;
revoke all on function public.cancel_stock_alert(uuid) from public, anon;
revoke all on function public.admin_low_stock_count() from public, anon;
revoke all on function private.stock_alert_recipients() from public;
grant execute on function public.request_stock_alert(uuid) to authenticated;
grant execute on function public.cancel_stock_alert(uuid) to authenticated;
grant execute on function public.admin_low_stock_count() to authenticated;
