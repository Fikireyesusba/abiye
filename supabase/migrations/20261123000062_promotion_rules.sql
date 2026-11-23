-- =============================================================================
-- 0062 PROMOTION RULES
--   * Every promo code can be used once per customer account (everyone or selected customers).
--   * A use counts once the payment is approved: the personal code is marked used (with the
--     order) and disappears from the customer's account. A rejected / cancelled order frees it.
--   * Revoke a promotion with a reason (anyone with promotions.manage). Only the Super Admin
--     can bring a revoked promotion back.
--   * Remove a code from a customer only with a reason, and only while it is not used.
--   * Delete: Super Admin only, only when the promotion was never used and nobody holds it
--     (remove it from the customers first).
--   * Personal codes can be given by User ID as well as by email.
-- =============================================================================

update public.promotions set once_per_customer = true where not once_per_customer;
alter table public.promotions alter column once_per_customer set default true;
alter table public.promotions add constraint promotions_once_per_customer check (once_per_customer);

alter table public.promotions
  add column revoked_at     timestamptz,
  add column revoked_by     uuid references auth.users(id) on delete set null,
  add column revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 5 and 300);
alter table public.promotions add constraint promotions_revoked_off check (revoked_at is null or not is_active);

alter table public.promotion_customers
  add column used_at       timestamptz,
  add column used_order_id uuid references public.orders(id) on delete set null;

-- Orders waiting for payment already hold the code (see apply_promotion); this records the
-- confirmed use when the payment is approved and frees it again if the order is cancelled.
update public.promotion_customers pc
   set used_at = o.payment_verified_at, used_order_id = o.id
  from public.orders o
 where o.promotion_id = pc.promotion_id and o.user_id = pc.user_id
   and o.payment_status = 'verified' and o.status not in ('expired', 'cancelled');

create or replace function private.promotion_redeemed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.promotion_id is null or new.user_id is null then return new; end if;
  if new.status in ('expired', 'cancelled') then
    update public.promotion_customers set used_at = null, used_order_id = null
     where used_order_id = new.id;
  elsif new.payment_status = 'verified' then
    update public.promotion_customers set used_at = coalesce(used_at, now()), used_order_id = new.id
     where promotion_id = new.promotion_id and user_id = new.user_id and used_order_id is distinct from new.id;
  end if;
  return new;
end;
$$;
create trigger orders_promotion_redeemed after insert or update of payment_status, status on public.orders
  for each row execute function private.promotion_redeemed();

-- Direct changes to promotions (the admin form) follow the rules too.
create or replace function private.promotions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.once_per_customer := true;
  if tg_op = 'UPDATE' then
    -- Revoking goes through admin_revoke_promotion (with a reason).
    if current_setting('app.promo_revoke', true) is distinct from 'on' then
      if old.revoked_at is not null and new.is_active then
        -- Bringing a revoked promotion back: Super Admin only.
        if coalesce(private.current_role_key(), '') <> 'super_admin' then perform private.app_error('forbidden'); end if;
        new.revoked_at := null; new.revoked_by := null; new.revoked_reason := null;
      else
        new.revoked_at := old.revoked_at; new.revoked_by := old.revoked_by; new.revoked_reason := old.revoked_reason;
      end if;
    end if;
    -- Turning a personal promotion into one for everyone would hand the code to everybody.
    if old.restricted and not new.restricted
       and exists (select 1 from public.promotion_customers pc where pc.promotion_id = old.id) then
      perform private.app_error('promo_has_customers');
    end if;
  else
    new.revoked_at := null; new.revoked_by := null; new.revoked_reason := null;
  end if;
  return new;
end;
$$;
create trigger promotions_guard before insert or update on public.promotions
  for each row execute function private.promotions_guard();

-- Deleting and removing codes from customers only through the functions below.
revoke delete on public.promotions from authenticated;
drop policy if exists promotion_customers_admin_delete on public.promotion_customers;
revoke delete on public.promotion_customers from authenticated;

-- Audit entries for giving / removing a code carry the reason.
create or replace function private.audit_promotion_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.promotion_customers := coalesce(new, old);
  v_code text;
  v_title text;
begin
  select p.code::text, p.title_en into v_code, v_title from public.promotions p where p.id = r.promotion_id;
  perform private.audit(
    case when tg_op = 'INSERT' then 'promo_assigned' else 'promo_unassigned' end,
    'customer_account', r.user_id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('code', v_code, 'promotion', v_title, 'promotion_id', r.promotion_id,
      'reason', case when tg_op = 'DELETE' then nullif(current_setting('app.promo_reason', true), '') end)));
  return r;
end;
$$;

create or replace function public.admin_revoke_promotion(p_promotion_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.promotions;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('promotions.manage');
  if char_length(v_reason) not between 5 and 300 then perform private.app_error('invalid_reason'); end if;
  select * into v from public.promotions where id = p_promotion_id for update;
  if not found then perform private.app_error('not_found'); end if;
  if v.revoked_at is not null then perform private.app_error('invalid_transition'); end if;
  perform set_config('app.promo_revoke', 'on', true);
  update public.promotions
     set is_active = false, show_on_homepage = false, revoked_at = now(), revoked_by = auth.uid(), revoked_reason = v_reason
   where id = p_promotion_id;
  perform set_config('app.promo_revoke', '', true);
  perform private.audit('promo_revoked', 'promotions', p_promotion_id::text, null, null,
    jsonb_build_object('code', v.code, 'promotion', v.title_en, 'reason', v_reason));
end;
$$;

create or replace function public.admin_unassign_promotion(p_promotion_id uuid, p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('promotions.manage');
  if char_length(v_reason) not between 5 and 300 then perform private.app_error('invalid_reason'); end if;
  if not exists (select 1 from public.promotion_customers where promotion_id = p_promotion_id and user_id = p_user_id) then
    perform private.app_error('not_found');
  end if;
  -- Used, or on an order still waiting for payment: it stays (the order keeps its discount).
  if exists (select 1 from public.orders o where o.promotion_id = p_promotion_id and o.user_id = p_user_id
              and o.status not in ('expired', 'cancelled')) then
    perform private.app_error('promo_in_use');
  end if;
  perform set_config('app.promo_reason', v_reason, true);
  delete from public.promotion_customers where promotion_id = p_promotion_id and user_id = p_user_id;
  perform set_config('app.promo_reason', '', true);
end;
$$;

create or replace function public.admin_delete_promotion(p_promotion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(private.current_role_key(), '') <> 'super_admin' or not private.mfa_verified() then perform private.app_error('forbidden'); end if;
  if not exists (select 1 from public.promotions where id = p_promotion_id) then perform private.app_error('not_found'); end if;
  if exists (select 1 from public.orders o where o.promotion_id = p_promotion_id and o.status not in ('expired', 'cancelled')) then
    perform private.app_error('promo_in_use');
  end if;
  if exists (select 1 from public.promotion_customers where promotion_id = p_promotion_id) then
    perform private.app_error('promo_has_customers');
  end if;
  delete from public.promotions where id = p_promotion_id;  -- expired / cancelled orders keep their amounts (promotion_id → null)
end;
$$;

-- Give a personal promotion by User ID or email.
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
  if v_promo.revoked_at is not null then perform private.app_error('invalid_transition'); end if;
  if p_emails is null or cardinality(p_emails) = 0 or cardinality(p_emails) > 200 then
    perform private.app_error('invalid_request');
  end if;
  foreach v_email in array p_emails loop
    v_email := lower(btrim(v_email));
    continue when v_email = '';
    v_user := null;
    if v_email ~ '^[1-9][0-9]{5}$' then
      select c.id into v_user from public.customer_accounts c where c.member_id = v_email;
    else
      select u.id into v_user from auth.users u where lower(u.email) = v_email;
    end if;
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

-- Holders of personal codes: User ID, used (payment approved, with the order) or reserved (waiting for payment).
drop function if exists public.admin_promotion_customers(uuid, uuid);
create function public.admin_promotion_customers(p_promotion_id uuid default null, p_user_id uuid default null)
returns table (promotion_id uuid, user_id uuid, member_id text, email text, full_name text, code text, title_en text,
               assigned_at timestamptz, used boolean, used_at timestamptz, used_order_number text, reserved boolean,
               revoked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('promotions.manage');
  return query
    select pc.promotion_id, pc.user_id, c.member_id::text, u.email::text, c.full_name, p.code::text, p.title_en, pc.created_at,
           pc.used_at is not null, pc.used_at, uo.order_number::text,
           pc.used_at is null and exists (select 1 from public.orders o where o.promotion_id = pc.promotion_id and o.user_id = pc.user_id
                    and o.status not in ('expired', 'cancelled')),
           p.revoked_at is not null
      from public.promotion_customers pc
      join public.promotions p on p.id = pc.promotion_id
      join auth.users u on u.id = pc.user_id
      left join public.customer_accounts c on c.id = pc.user_id
      left join public.orders uo on uo.id = pc.used_order_id
     where (p_promotion_id is null or pc.promotion_id = p_promotion_id)
       and (p_user_id is null or pc.user_id = p_user_id)
     order by pc.created_at desc
     limit 1000;
end;
$$;

-- The customer's own codes: used ones disappear.
create or replace function public.my_offers()
returns table (code text, title_en text, title_am text, description_en text, description_am text,
               discount_type text, discount_value numeric, min_order_etb numeric, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.code::text, p.title_en, p.title_am, p.description_en, p.description_am,
         p.discount_type, p.discount_value, p.min_order_etb, p.ends_at
    from public.promotion_customers pc
    join public.promotions p on p.id = pc.promotion_id
   where pc.user_id = (select auth.uid())
     and private.is_active_customer()
     and pc.used_at is null
     and p.restricted and p.is_active and p.revoked_at is null and p.code is not null
     and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
     and not exists (
       select 1 from public.orders o where o.promotion_id = p.id and o.user_id = pc.user_id
          and o.status not in ('expired', 'cancelled'))
     and (p.max_redemptions is null or (
       select count(*) from public.orders o where o.promotion_id = p.id
          and o.status not in ('expired', 'cancelled')) < p.max_redemptions)
   order by p.ends_at nulls last, pc.created_at desc
$$;

revoke all on function public.admin_revoke_promotion(uuid, text) from public, anon;
revoke all on function public.admin_unassign_promotion(uuid, uuid, text) from public, anon;
revoke all on function public.admin_delete_promotion(uuid) from public, anon;
revoke all on function public.admin_promotion_customers(uuid, uuid) from public, anon;
revoke all on function private.promotion_redeemed() from public;
revoke all on function private.promotions_guard() from public;
grant execute on function public.admin_revoke_promotion(uuid, text) to authenticated;
grant execute on function public.admin_unassign_promotion(uuid, uuid, text) to authenticated;
grant execute on function public.admin_delete_promotion(uuid) to authenticated;
grant execute on function public.admin_promotion_customers(uuid, uuid) to authenticated;
