-- =============================================================================
-- 0032 PRODUCT REVIEWS
--   Customers who received a product (order completed) rate it 1–5 with an optional
--   comment. Reviews appear only after a Super Admin / Manager approves them.
--   Public sees: rating, comment, first name + initial, date. Never email or order.
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('reviews.manage', 'Approve or reject product reviews')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select id, 'reviews.manage' from public.admin_roles where key in ('super_admin', 'manager')
on conflict do nothing;

alter table public.products
  add column rating_avg numeric(2,1) check (rating_avg between 1 and 5),
  add column rating_count integer not null default 0 check (rating_count >= 0);
grant select (rating_avg, rating_count) on public.products to anon;

create table public.product_reviews (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  order_id     uuid references public.orders(id) on delete set null,
  rating       smallint not null check (rating between 1 and 5),
  body         text check (char_length(body) <= 1000),
  display_name text not null check (char_length(display_name) between 1 and 40),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note  text check (char_length(review_note) <= 500),
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (product_id, user_id)
);
create index product_reviews_product_idx on public.product_reviews(product_id, created_at desc) where status = 'approved';
create index product_reviews_pending_idx on public.product_reviews(created_at) where status = 'pending';
create trigger product_reviews_updated_at before update on public.product_reviews
  for each row execute function private.set_updated_at();

alter table public.product_reviews enable row level security;
revoke all on public.product_reviews from anon, authenticated;
-- Public: approved reviews, safe columns only. Everything else goes through the functions below.
grant select (id, product_id, rating, body, display_name, created_at) on public.product_reviews to anon, authenticated;
create policy product_reviews_public_read on public.product_reviews for select to anon, authenticated
  using (status = 'approved');

-- "Mekdes Alemu" → "Mekdes A."
create or replace function private.review_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(left(
           split_part(btrim(regexp_replace(coalesce(a.full_name, ''), '\s+', ' ', 'g')), ' ', 1)
           || coalesce(' ' || nullif(left(split_part(btrim(regexp_replace(coalesce(a.full_name, ''), '\s+', ' ', 'g')), ' ', 2), 1), '') || '.', ''),
         40), ''), 'Customer')
    from (select 1) x left join public.customer_accounts a on a.id = p_user
$$;

-- The completed order through which the customer received this product (null = not eligible).
create or replace function private.review_order(p_user uuid, p_product uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.orders o join public.order_items i on i.order_id = o.id
   where o.user_id = p_user and i.product_id = p_product and o.status = 'completed'
   order by o.created_at desc limit 1
$$;

-- Signed-in customer: may I review this product, and what did I write?
create or replace function public.my_product_review(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r public.product_reviews;
begin
  if v_uid is null then return jsonb_build_object('eligible', false); end if;
  select * into r from public.product_reviews where product_id = p_product_id and user_id = v_uid;
  return jsonb_build_object(
    'eligible', private.is_active_user(v_uid) and not exists (select 1 from public.profiles where id = v_uid)
                and private.review_order(v_uid, p_product_id) is not null,
    'review', case when r.id is null then null else jsonb_build_object('rating', r.rating, 'body', r.body, 'status', r.status, 'note', r.review_note) end);
end;
$$;

create or replace function public.submit_product_review(p_product_id uuid, p_rating integer, p_body text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order uuid;
  v_body text := nullif(btrim(regexp_replace(coalesce(p_body, ''), '[\r\n]{3,}', E'\n\n', 'g')), '');
begin
  perform private.assert_confirmed_user(v_uid);
  if p_rating is null or p_rating not between 1 and 5 then perform private.app_error('invalid_request', 'rating'); end if;
  if v_body is not null and char_length(v_body) > 1000 then perform private.app_error('invalid_request', 'body'); end if;
  v_order := private.review_order(v_uid, p_product_id);
  if v_order is null then perform private.app_error('forbidden', 'not_purchased'); end if;
  if (select count(*) from public.product_reviews where user_id = v_uid and updated_at > now() - interval '1 day') >= 20 then
    perform private.app_error('rate_limited');
  end if;
  insert into public.product_reviews (product_id, user_id, order_id, rating, body, display_name)
  values (p_product_id, v_uid, v_order, p_rating, v_body, private.review_display_name(v_uid))
  on conflict (product_id, user_id) do update
     set rating = excluded.rating, body = excluded.body, display_name = excluded.display_name, order_id = excluded.order_id,
         status = 'pending', review_note = null, reviewed_by = null, reviewed_at = null;  -- edits are checked again
end;
$$;

create or replace function public.delete_my_product_review(p_product_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.product_reviews where product_id = p_product_id and user_id = (select auth.uid());
$$;

-- Admin list (reviews.manage).
create or replace function public.admin_product_reviews(p_status text default 'pending', p_limit integer default 100)
returns table (
  id uuid, product_id uuid, product_name text, product_slug text, rating smallint, body text, display_name text,
  customer_email text, order_id uuid, order_number text, status text, review_note text, reviewed_by_name text,
  reviewed_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('reviews.manage');
  if p_status not in ('pending', 'approved', 'rejected') then perform private.app_error('invalid_request'); end if;
  return query
    select r.id, r.product_id, p.name_en, p.slug, r.rating, r.body, r.display_name, u.email::text, r.order_id, o.order_number,
           r.status, r.review_note, private.actor_name(r.reviewed_by), r.reviewed_at, r.created_at, r.updated_at
      from public.product_reviews r
      join public.products p on p.id = r.product_id
      left join auth.users u on u.id = r.user_id
      left join public.orders o on o.id = r.order_id
     where r.status = p_status
     order by case when p_status = 'pending' then r.updated_at end asc, r.updated_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.admin_moderate_review(p_review_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.product_reviews;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.require_permission('reviews.manage');
  if p_decision not in ('approved', 'rejected') then perform private.app_error('invalid_decision'); end if;
  if v_note is not null and char_length(v_note) > 500 then perform private.app_error('invalid_request', 'note'); end if;
  select * into r from public.product_reviews where id = p_review_id for update;
  if not found then perform private.app_error('not_found'); end if;
  update public.product_reviews
     set status = p_decision, review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_review_id;
  perform private.audit('review_' || p_decision, 'product_review', p_review_id::text,
                        jsonb_build_object('status', r.status), jsonb_build_object('status', p_decision),
                        jsonb_build_object('product_id', r.product_id, 'rating', r.rating, 'note', v_note));
end;
$$;

-- Keep the product's average / count of APPROVED reviews up to date.
create or replace function private.refresh_product_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p
     set rating_avg = s.avg, rating_count = s.n
    from (select round(avg(rating)::numeric, 1) as avg, count(*)::int as n
            from public.product_reviews where product_id = v_product and status = 'approved') s
   where p.id = v_product
     and (p.rating_avg is distinct from s.avg or p.rating_count is distinct from s.n);
  return null;
end;
$$;
create trigger product_reviews_rating after insert or update of status, rating or delete on public.product_reviews
  for each row execute function private.refresh_product_rating();

revoke all on function public.my_product_review(uuid) from public, anon;
revoke all on function public.submit_product_review(uuid, integer, text) from public, anon;
revoke all on function public.delete_my_product_review(uuid) from public, anon;
revoke all on function public.admin_product_reviews(text, integer) from public, anon;
revoke all on function public.admin_moderate_review(uuid, text, text) from public, anon;
revoke all on function private.review_display_name(uuid) from public;
revoke all on function private.review_order(uuid, uuid) from public;
grant execute on function public.my_product_review(uuid) to authenticated;
grant execute on function public.submit_product_review(uuid, integer, text) to authenticated;
grant execute on function public.delete_my_product_review(uuid) to authenticated;
grant execute on function public.admin_product_reviews(text, integer) to authenticated;
grant execute on function public.admin_moderate_review(uuid, text, text) to authenticated;
