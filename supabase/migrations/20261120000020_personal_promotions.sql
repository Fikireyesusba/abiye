-- =============================================================================
-- 0020 PERSONAL PROMO CODES
--   * promotions.restricted: only customers listed in promotion_customers can
--     use the code (checked in private.apply_promotion, i.e. inside checkout).
--   * Personal promotions are never public (no homepage, not readable by anon).
--   * Customers see their own codes via my_offers().
--   * Giving / removing a code is recorded in the audit log (customer timeline
--     and Activity log).
-- =============================================================================

alter table public.promotions add column restricted boolean not null default false;
alter table public.promotions add constraint promotions_personal_not_public check (not (restricted and show_on_homepage));

drop policy promotions_public_read on public.promotions;
create policy promotions_public_read on public.promotions for select to anon, authenticated
  using (is_active and show_on_homepage and not restricted
         and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));

create table public.promotion_customers (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  primary key (promotion_id, user_id)
);
create index promotion_customers_user_idx on public.promotion_customers(user_id);

alter table public.promotion_customers enable row level security;
revoke all on public.promotion_customers from anon, authenticated;
grant select, delete on public.promotion_customers to authenticated;
create policy promotion_customers_admin_read on public.promotion_customers for select to authenticated
  using ((select private.has_permission('promotions.manage')));
create policy promotion_customers_admin_delete on public.promotion_customers for delete to authenticated
  using ((select private.has_permission('promotions.manage')));
-- Adding goes through admin_assign_promotion() (resolves emails, validates).

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
    jsonb_strip_nulls(jsonb_build_object('code', v_code, 'promotion', v_title, 'promotion_id', r.promotion_id)));
  return r;
end;
$$;
create trigger audit_promotion_customers after insert or delete on public.promotion_customers
  for each row execute function private.audit_promotion_customer();

-- Give a personal promotion to customers by email. Returns what happened per email.
create or replace function public.admin_assign_promotion(p_promotion_id uuid, p_emails text[])
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
    if found then v_added := v_added || v_email; else v_already := v_already || v_email; end if;
  end loop;
  return jsonb_build_object('added', to_jsonb(v_added), 'already', to_jsonb(v_already), 'not_found', to_jsonb(v_missing));
end;
$$;

-- Customers who hold a personal promotion (admin view, with emails and whether they used it).
create or replace function public.admin_promotion_customers(p_promotion_id uuid default null, p_user_id uuid default null)
returns table (promotion_id uuid, user_id uuid, email text, full_name text, code text, title_en text,
               assigned_at timestamptz, used boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('promotions.manage');
  return query
    select pc.promotion_id, pc.user_id, u.email::text, c.full_name, p.code::text, p.title_en, pc.created_at,
           exists (select 1 from public.orders o where o.promotion_id = pc.promotion_id and o.user_id = pc.user_id
                    and o.status not in ('expired', 'cancelled'))
      from public.promotion_customers pc
      join public.promotions p on p.id = pc.promotion_id
      join auth.users u on u.id = pc.user_id
      left join public.customer_accounts c on c.id = pc.user_id
     where (p_promotion_id is null or pc.promotion_id = p_promotion_id)
       and (p_user_id is null or pc.user_id = p_user_id)
     order by pc.created_at desc
     limit 1000;
end;
$$;

-- The signed-in customer's personal codes that can still be used.
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
     and p.restricted and p.is_active and p.code is not null
     and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
     and not (p.once_per_customer and exists (
       select 1 from public.orders o where o.promotion_id = p.id and o.user_id = pc.user_id
          and o.status not in ('expired', 'cancelled')))
     and (p.max_redemptions is null or (
       select count(*) from public.orders o where o.promotion_id = p.id
          and o.status not in ('expired', 'cancelled')) < p.max_redemptions)
   order by p.ends_at nulls last, pc.created_at desc
$$;

create or replace function private.apply_promotion(
  p_code text, p_lines jsonb, p_subtotal numeric, p_fee numeric, p_user uuid, p_lock boolean)
returns table (promotion_id uuid, discount_etb numeric, title_en text, title_am text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.promotions;
  v_code   text := lower(btrim(coalesce(p_code, '')));
  v_amount numeric(12,2);
  v_disc   numeric(12,2);
begin
  if v_code !~ '^[a-z0-9_-]{3,30}$' then perform private.app_error('invalid_promo_code'); end if;
  if p_lock then
    select * into v from public.promotions p where lower(p.code::text) = v_code for update;
  else
    select * into v from public.promotions p where lower(p.code::text) = v_code;
  end if;
  if not found or not v.is_active
     or (v.starts_at is not null and v.starts_at > now())
     or (v.ends_at is not null and v.ends_at <= now()) then
    perform private.app_error('invalid_promo_code');
  end if;
  -- Personal codes: only the chosen customer accounts can use them (others: "not valid").
  if v.restricted and (p_user is null or not exists (
       select 1 from public.promotion_customers pc where pc.promotion_id = v.id and pc.user_id = p_user)) then
    perform private.app_error('invalid_promo_code');
  end if;
  if p_subtotal < v.min_order_etb then
    perform private.app_error('promo_min_order', v.min_order_etb::text);
  end if;

  select coalesce(sum((l ->> 'unit')::numeric * (l ->> 'qty')::integer), 0) into v_amount
    from jsonb_array_elements(p_lines) l
    left join public.products pr on pr.id = (l ->> 'product_id')::uuid
    left join public.categories c on c.id = pr.category_id
   where l ->> 'item_type' = 'product'
     and (v.product_id is null or pr.id = v.product_id)
     and (v.category_id is null or pr.category_id = v.category_id or c.parent_id = v.category_id);
  if v_amount <= 0 then perform private.app_error('promo_not_applicable'); end if;

  if v.max_redemptions is not null and (
       select count(*) from public.orders o
        where o.promotion_id = v.id and o.status not in ('expired', 'cancelled')) >= v.max_redemptions then
    perform private.app_error('promo_limit_reached');
  end if;
  if v.once_per_customer and p_user is not null and exists (
       select 1 from public.orders o
        where o.promotion_id = v.id and o.user_id = p_user and o.status not in ('expired', 'cancelled')) then
    perform private.app_error('promo_already_used');
  end if;

  v_disc := case when v.discount_type = 'percent' then round(v_amount * v.discount_value / 100, 2)
                 else least(v.discount_value, v_amount) end;
  v_disc := least(v_disc, p_subtotal + p_fee - 1); -- an order always costs at least 1 ETB
  if v_disc <= 0 then perform private.app_error('promo_not_applicable'); end if;
  return query select v.id, v_disc, v.title_en, v.title_am;
end;
$$;

revoke execute on function public.admin_assign_promotion(uuid, text[]) from public, anon;
revoke execute on function public.admin_promotion_customers(uuid, uuid) from public, anon;
revoke execute on function public.my_offers() from public, anon;
grant execute on function public.admin_assign_promotion(uuid, text[]) to authenticated;
grant execute on function public.admin_promotion_customers(uuid, uuid) to authenticated;
grant execute on function public.my_offers() to authenticated;
