-- 0052:
--   * User ID: 6 digits (numbers only, 100000–999999) for every account; shown with
--     every activity-log entry (who did it, and which customer it concerns) and searchable.
--   * Signed-in users: active sessions, last sign-in of every account (date range / before),
--     and sign a user out (Super Admin: security.manage).
--   * App installs: devices that installed the app (list + count).
--   * Printing: staff alerts only once the payment is submitted (documents go to the printing
--     Telegram group at that moment); payment rejected → the job is cancelled and its files are
--     deleted from storage (they stay in Telegram).
--   * Support & feedback tickets (signed-in customers), managed by staff (support.view /
--     support.manage), with their own Telegram group ("support").

-- ============================================================ 1. User ID: 6 digits
create or replace function private.new_member_id()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  loop
    v_id := (100000 + floor(random() * 900000))::int::text;
    exit when not exists (select 1 from public.customer_accounts where member_id = v_id);
  end loop;
  return v_id;
end;
$$;
revoke all on function private.new_member_id() from public, anon, authenticated;

alter table public.customer_accounts drop constraint if exists customer_accounts_member_id_format;
alter table public.customer_accounts disable trigger customer_accounts_member_id;
do $$
declare r record;
begin
  -- the letter IDs given yesterday become numbers (nobody relies on them yet)
  for r in select id from public.customer_accounts where member_id !~ '^[1-9][0-9]{5}$' loop
    update public.customer_accounts set member_id = 'tmp-' || r.id where id = r.id;
  end loop;
  for r in select id from public.customer_accounts where member_id like 'tmp-%' loop
    update public.customer_accounts set member_id = private.new_member_id() where id = r.id;
  end loop;
end;
$$;
alter table public.customer_accounts enable trigger customer_accounts_member_id;
alter table public.customer_accounts add constraint customer_accounts_member_id_format check (member_id ~ '^[1-9][0-9]{5}$');

-- The User ID of an account (null if unknown).
create or replace function private.member_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member_id from public.customer_accounts where id = p_user
$$;
revoke all on function private.member_of(uuid) from public, anon, authenticated;

-- ============================================================ 2. Support tickets 
create sequence if not exists public.support_ticket_number_seq start 1001;
revoke all on sequence public.support_ticket_number_seq from anon, authenticated;

create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  ticket_number   text not null unique default ('T-' || nextval('public.support_ticket_number_seq')),
  user_id         uuid not null references auth.users(id) on delete cascade,
  category        text not null check (category in ('order', 'payment', 'delivery', 'printing', 'wallet', 'account', 'product', 'app', 'other')),
  order_id        uuid references public.orders(id) on delete set null,
  order_number    text check (order_number is null or order_number ~ '^ET-[0-9]{5,9}$'),
  subject         text not null check (char_length(subject) between 3 and 120),
  details         text not null check (char_length(details) between 10 and 3000),
  status          text not null default 'open' check (status in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  assigned_to     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  resolved_at     timestamptz,
  closed_at       timestamptz
);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets(status, created_at desc);
drop trigger if exists support_tickets_updated_at on public.support_tickets;
create trigger support_tickets_updated_at before update on public.support_tickets
  for each row execute function private.set_updated_at();

create table if not exists public.support_ticket_messages (
  id          bigint generated always as identity primary key,
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  from_staff  boolean not null default false,
  internal    boolean not null default false check (not internal or from_staff),
  body        text not null check (char_length(body) between 1 and 3000),
  created_at  timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, id);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
revoke all on public.support_tickets, public.support_ticket_messages from anon, authenticated;
grant select on public.support_tickets, public.support_ticket_messages to authenticated;

insert into public.admin_permissions (key, description) values
  ('support.view', 'See support tickets'),
  ('support.manage', 'Answer support tickets and change their status')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r cross join (values ('support.view'), ('support.manage')) p(key)
 where r.key in ('super_admin', 'manager')
on conflict do nothing;

drop policy if exists support_tickets_own_read on public.support_tickets;
create policy support_tickets_own_read on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_customer()));
drop policy if exists support_tickets_staff_read on public.support_tickets;
create policy support_tickets_staff_read on public.support_tickets for select to authenticated
  using ((select private.has_permission('support.view')));
drop policy if exists support_messages_own_read on public.support_ticket_messages;
create policy support_messages_own_read on public.support_ticket_messages for select to authenticated
  using (not internal and (select private.is_active_customer())
         and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid())));
drop policy if exists support_messages_staff_read on public.support_ticket_messages;
create policy support_messages_staff_read on public.support_ticket_messages for select to authenticated
  using ((select private.has_permission('support.view')));

-- Customer opens a ticket. Order-related topics need one of the customer's own order numbers.
create or replace function public.customer_create_ticket(p_category text, p_order_number text, p_subject text, p_details text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_number text := nullif(upper(regexp_replace(coalesce(p_order_number, ''), '\s', '', 'g')), '');
  v_order public.orders;
  v_subject text := nullif(left(btrim(coalesce(p_subject, '')), 120), '');
  v_details text := btrim(coalesce(p_details, ''));
  v_ticket public.support_tickets;
begin
  if not private.is_active_customer() then perform private.app_error('login_required'); end if;
  if p_category not in ('order', 'payment', 'delivery', 'printing', 'wallet', 'account', 'product', 'app', 'other') then
    perform private.app_error('invalid_request', 'category');
  end if;
  if char_length(v_details) < 10 or char_length(v_details) > 3000 then perform private.app_error('invalid_request', 'details'); end if;
  if p_category = 'other' and (v_subject is null or char_length(v_subject) < 3) then perform private.app_error('invalid_request', 'subject'); end if;
  if (select count(*) from public.support_tickets where user_id = v_uid and created_at > now() - interval '1 day') >= 10
     or (select count(*) from public.support_tickets where user_id = v_uid and status in ('open', 'in_progress', 'waiting_customer')) >= 5 then
    perform private.app_error('rate_limited');
  end if;
  if v_number is not null then
    v_number := regexp_replace(v_number, '^ET-?', 'ET-');
    select * into v_order from public.orders where order_number = v_number and user_id = v_uid;
    if not found then perform private.app_error('order_not_found'); end if;
  elsif p_category in ('order', 'payment', 'delivery') then
    perform private.app_error('order_not_found');
  end if;
  insert into public.support_tickets (user_id, category, order_id, order_number, subject, details)
  values (v_uid, p_category, v_order.id, v_order.order_number,
          coalesce(v_subject, case p_category
            when 'order' then 'Order problem' when 'payment' then 'Payment problem' when 'delivery' then 'Delivery or pickup'
            when 'printing' then 'Printing service' when 'wallet' then 'My balance' when 'account' then 'My account'
            when 'product' then 'Product question' when 'app' then 'Website or app problem' end),
          v_details)
  returning * into v_ticket;
  perform private.audit('ticket_created', 'support_ticket', v_ticket.id::text, null,
    jsonb_build_object('category', p_category, 'subject', v_ticket.subject), jsonb_build_object('ticket_number', v_ticket.ticket_number));
  perform private.enqueue_notification('support_ticket', 'support_ticket:' || v_ticket.id,
    jsonb_build_object('ticket_id', v_ticket.id, 'number', v_ticket.ticket_number, 'category', p_category, 'subject', v_ticket.subject,
      'details', left(v_details, 1500), 'order_number', v_ticket.order_number, 'user_id', private.member_of(v_uid),
      'customer', (select full_name from public.customer_accounts where id = v_uid),
      'email', (select email::text from auth.users where id = v_uid)));
  return jsonb_build_object('ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number);
end;
$$;
revoke all on function public.customer_create_ticket(text, text, text, text) from public, anon;
grant execute on function public.customer_create_ticket(text, text, text, text) to authenticated;

-- Customer adds a message to their own ticket (re-opens a resolved one; closed tickets are final).
create or replace function public.customer_reply_ticket(p_ticket_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.support_tickets;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not private.is_active_customer() then perform private.app_error('login_required'); end if;
  select * into v_t from public.support_tickets where id = p_ticket_id and user_id = (select auth.uid()) for update;
  if not found then perform private.app_error('not_found'); end if;
  if v_t.status = 'closed' then perform private.app_error('invalid_transition', 'closed'); end if;
  if char_length(v_body) < 1 or char_length(v_body) > 3000 then perform private.app_error('invalid_request', 'message'); end if;
  if (select count(*) from public.support_ticket_messages where ticket_id = v_t.id and not from_staff and created_at > now() - interval '1 hour') >= 20 then
    perform private.app_error('rate_limited');
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, from_staff, body) values (v_t.id, (select auth.uid()), false, v_body);
  update public.support_tickets
     set last_message_at = now(),
         status = case when status in ('waiting_customer', 'resolved') then 'open' else status end,
         resolved_at = case when status = 'resolved' then null else resolved_at end
   where id = v_t.id;
  perform private.enqueue_notification('support_reply', 'support_reply:' || v_t.id || ':' || (select max(id) from public.support_ticket_messages where ticket_id = v_t.id),
    jsonb_build_object('ticket_id', v_t.id, 'number', v_t.ticket_number, 'subject', v_t.subject, 'message', left(v_body, 1500),
      'user_id', private.member_of(v_t.user_id), 'customer', (select full_name from public.customer_accounts where id = v_t.user_id)));
end;
$$;
revoke all on function public.customer_reply_ticket(uuid, text) from public, anon;
grant execute on function public.customer_reply_ticket(uuid, text) to authenticated;

-- Staff: status, assignee, and a message (to the customer, or an internal note).
create or replace function public.admin_update_ticket(
  p_ticket_id uuid, p_status text default null, p_assigned_to uuid default null, p_unassign boolean default false,
  p_message text default null, p_internal boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.support_tickets;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_status text;
begin
  perform private.require_permission('support.manage');
  select * into v_t from public.support_tickets where id = p_ticket_id for update;
  if not found then perform private.app_error('not_found'); end if;
  if p_status is not null and p_status not in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed') then
    perform private.app_error('invalid_request', 'status');
  end if;
  if p_assigned_to is not null and not exists (select 1 from public.profiles where id = p_assigned_to and is_active and removed_at is null) then
    perform private.app_error('invalid_assignee');
  end if;
  if v_msg is not null and char_length(v_msg) > 3000 then perform private.app_error('invalid_request', 'message'); end if;
  -- A reply to the customer waits for them unless another status is chosen.
  v_status := coalesce(p_status, case when v_msg is not null and not p_internal and v_t.status in ('open', 'in_progress') then 'waiting_customer' else v_t.status end);
  if v_msg is not null then
    insert into public.support_ticket_messages (ticket_id, author_id, from_staff, internal, body)
    values (v_t.id, (select auth.uid()), true, coalesce(p_internal, false), v_msg);
  end if;
  update public.support_tickets
     set status = v_status,
         assigned_to = case when p_unassign then null else coalesce(p_assigned_to, assigned_to) end,
         last_message_at = case when v_msg is not null then now() else last_message_at end,
         resolved_at = case when v_status = 'resolved' and v_t.status <> 'resolved' then now() when v_status in ('open', 'in_progress', 'waiting_customer') then null else resolved_at end,
         closed_at = case when v_status = 'closed' and v_t.status <> 'closed' then now() when v_status <> 'closed' then null else closed_at end
   where id = v_t.id;
  perform private.audit('ticket_updated', 'support_ticket', v_t.id::text,
    jsonb_build_object('status', v_t.status, 'assigned_to', private.actor_name(v_t.assigned_to)),
    jsonb_build_object('status', v_status, 'assigned_to', private.actor_name(case when p_unassign then null else coalesce(p_assigned_to, v_t.assigned_to) end),
                       'replied', v_msg is not null and not p_internal, 'note', v_msg is not null and p_internal),
    jsonb_build_object('ticket_number', v_t.ticket_number));
  -- The customer hears about replies and status changes (email + phone notification).
  if (v_msg is not null and not p_internal) or v_status is distinct from v_t.status then
    perform private.enqueue_customer_email('customer_ticket_update', 'ticket:' || v_t.id || ':' || extract(epoch from clock_timestamp())::text, v_t.user_id,
      jsonb_build_object('ticket_id', v_t.id, 'number', v_t.ticket_number, 'subject', v_t.subject, 'status', v_status,
        'message', case when p_internal then null else left(v_msg, 1500) end));
  end if;
end;
$$;
revoke all on function public.admin_update_ticket(uuid, text, uuid, boolean, text, boolean) from public, anon;
grant execute on function public.admin_update_ticket(uuid, text, uuid, boolean, text, boolean) to authenticated;

create or replace function public.admin_support_tickets(
  p_status text default null, p_search text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 300)
returns table (
  id uuid, ticket_number text, user_id uuid, member_id text, customer_name text, email text, category text, order_id uuid, order_number text,
  subject text, status text, assigned_name text, created_at timestamptz, last_message_at timestamptz, messages bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('support.view');
  return query
    select t.id, t.ticket_number, t.user_id, c.member_id, c.full_name, u.email::text, t.category, t.order_id, t.order_number,
           t.subject, t.status, private.actor_name(t.assigned_to), t.created_at, t.last_message_at,
           (select count(*) from public.support_ticket_messages m where m.ticket_id = t.id)
      from public.support_tickets t
      join auth.users u on u.id = t.user_id
      left join public.customer_accounts c on c.id = t.user_id
     where (p_status is null or t.status = p_status)
       and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to)
       and (v_q is null or t.ticket_number ilike '%' || v_q || '%' or t.subject ilike '%' || v_q || '%' or t.details ilike '%' || v_q || '%'
            or c.member_id = v_q or c.full_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%' or t.order_number ilike '%' || v_q || '%')
     order by case t.status when 'open' then 0 when 'in_progress' then 1 when 'waiting_customer' then 2 else 3 end, t.last_message_at desc
     limit greatest(1, least(coalesce(p_limit, 300), 1000));
end;
$$;
revoke all on function public.admin_support_tickets(text, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_support_tickets(text, text, timestamptz, timestamptz, integer) to authenticated;

-- The person an activity entry is about (customer of an order, payment, printing job, top-up, ticket; the account itself).
create or replace function private.subject_user(p_entity_type text, p_entity_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_entity_id !~ '^[0-9a-fA-F-]{36}$' then null
    when p_entity_type in ('customer_account', 'profiles') then p_entity_id::uuid
    when p_entity_type = 'order' then (select o.user_id from public.orders o where o.id = p_entity_id::uuid)
    when p_entity_type = 'payment_submission' then
      (select o.user_id from public.payment_submissions s join public.orders o on o.id = s.order_id where s.id = p_entity_id::uuid)
    when p_entity_type = 'printing_job' then
      (select o.user_id from public.printing_jobs j join public.orders o on o.id = j.order_id where j.id = p_entity_id::uuid)
    when p_entity_type = 'wallet_topup' then (select t.user_id from public.wallet_topups t where t.id = p_entity_id::uuid)
    when p_entity_type = 'support_ticket' then (select t.user_id from public.support_tickets t where t.id = p_entity_id::uuid)
    else null
  end
$$;
revoke all on function private.subject_user(text, text) from public, anon, authenticated;

-- ============================================================ 3. Activity log with User IDs
drop function if exists public.admin_activity_by_category(text, text, integer, bigint, timestamptz, timestamptz);
create function public.admin_activity_by_category(
  p_category text default null, p_search text default null, p_limit integer default 100, p_before_id bigint default null,
  p_from timestamptz default null, p_to timestamptz default null)
returns table (
  id bigint, created_at timestamptz, actor_id uuid, actor_name text, actor_role text,
  action text, entity_type text, entity_id text, entity_label text,
  before_data jsonb, after_data jsonb, metadata jsonb, category text,
  actor_member_id text, subject_member_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_uid uuid;
begin
  perform private.require_permission('audit.view');
  if p_category is not null and p_category not in ('orders', 'payments', 'customers', 'catalog', 'staff', 'security', 'other') then
    perform private.app_error('invalid_request', 'category');
  end if;
  -- A 6-digit search is a User ID: everything that person did, and everything about them.
  if v_q ~ '^[0-9]{6}$' then select c.id into v_uid from public.customer_accounts c where c.member_id = v_q; end if;
  return query
    select a.id, a.created_at, a.actor_id, private.actor_name(a.actor_id), a.actor_role,
           a.action, a.entity_type, a.entity_id,
           case a.entity_type
             when 'order' then (select o.order_number from public.orders o where o.id::text = a.entity_id)
             when 'printing_job' then (select j.job_number from public.printing_jobs j where j.id::text = a.entity_id)
             when 'payment_submission' then (select o.order_number from public.payment_submissions s join public.orders o on o.id = s.order_id where s.id::text = a.entity_id)
             when 'customer_account' then coalesce(
               (select u.email::text from auth.users u where u.id::text = a.entity_id), a.before_data ->> 'email')
             when 'profiles' then private.actor_name(case when a.entity_id ~ '^[0-9a-f-]{36}$' then a.entity_id::uuid end)
             when 'products' then coalesce(a.after_data ->> 'name_en', a.before_data ->> 'name_en')
             when 'support_ticket' then (select t.ticket_number from public.support_tickets t where t.id::text = a.entity_id)
             else null
           end,
           a.before_data, a.after_data, a.metadata, private.activity_category(a.action, a.entity_type),
           private.member_of(a.actor_id), private.member_of(private.subject_user(a.entity_type, a.entity_id))
      from public.audit_logs a
     where (p_category is null or private.activity_category(a.action, a.entity_type) = p_category)
       and (p_before_id is null or a.id < p_before_id)
       and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to)
       and (v_q is null
            or (v_uid is not null and (a.actor_id = v_uid or private.subject_user(a.entity_type, a.entity_id) = v_uid))
            or a.action ilike '%' || v_q || '%' or a.entity_id ilike '%' || v_q || '%'
            or private.actor_name(a.actor_id) ilike '%' || v_q || '%')
     order by a.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;
revoke all on function public.admin_activity_by_category(text, text, integer, bigint, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_activity_by_category(text, text, integer, bigint, timestamptz, timestamptz) to authenticated;

drop function if exists public.admin_activity_export(timestamptz, timestamptz, text);
create function public.admin_activity_export(p_from timestamptz, p_to timestamptz, p_entity_type text default null)
returns table (
  id bigint, created_at timestamptz, actor_name text, actor_role text, action text, entity_type text, entity_id text,
  entity_label text, before_data jsonb, after_data jsonb, metadata jsonb, actor_member_id text, subject_member_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit.view');
  if p_from is null or p_to is null or p_to <= p_from then perform private.app_error('invalid_request'); end if;
  return query
    select a.id, a.created_at, private.actor_name(a.actor_id), a.actor_role, a.action, a.entity_type, a.entity_id,
           case a.entity_type
             when 'order' then (select o.order_number from public.orders o where o.id::text = a.entity_id)
             when 'printing_job' then (select j.job_number from public.printing_jobs j where j.id::text = a.entity_id)
             when 'customer_account' then coalesce((select u.email::text from auth.users u where u.id::text = a.entity_id), a.before_data ->> 'email')
             when 'products' then coalesce(a.after_data ->> 'name_en', a.before_data ->> 'name_en')
             when 'support_ticket' then (select t.ticket_number from public.support_tickets t where t.id::text = a.entity_id)
             else null
           end,
           a.before_data, a.after_data, a.metadata,
           private.member_of(a.actor_id), private.member_of(private.subject_user(a.entity_type, a.entity_id))
      from public.audit_logs a
     where a.created_at >= p_from and a.created_at < p_to
       and (p_entity_type is null or a.entity_type = p_entity_type)
     order by a.id
     limit 50000;
end;
$$;
revoke all on function public.admin_activity_export(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_activity_export(timestamptz, timestamptz, text) to authenticated;

create or replace function private.activity_category(p_action text, p_entity_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_entity_type in ('security', 'audit', 'data', 'export') or p_action like 'export\_%' or p_action = 'user_signed_out' then 'security'
    when p_entity_type = 'payment_submission' or p_action like 'topup\_%' or p_action like 'payment\_%' or p_action = 'wallet_adjusted' then 'payments'
    when p_entity_type in ('order', 'printing_job') then 'orders'
    when p_entity_type in ('customer_account', 'support_ticket') then 'customers'
    when p_entity_type in ('products', 'categories', 'promotions', 'delivery_zones', 'printing_price_rules', 'homepage_banners',
                           'product_review', 'product_images') then 'catalog'
    when p_entity_type in ('profiles', 'role_permissions', 'website_settings', 'bank_accounts', 'notification') then 'staff'
    else 'other'
  end
$$;

-- ============================================================ 4. Signed-in users
create or replace function public.admin_signed_in_users(p_search text default null)
returns table (
  session_id uuid, user_id uuid, member_id text, full_name text, email text, is_staff boolean, role_name text,
  signed_in_at timestamptz, last_active_at timestamptz, ip text, user_agent text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('security.manage');
  return query
    select s.id, s.user_id, c.member_id, coalesce(p.full_name, c.full_name), u.email::text, p.id is not null, r.name,
           s.created_at,
           greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'UTC'),
           host(s.ip), left(s.user_agent, 300)
      from auth.sessions s
      join auth.users u on u.id = s.user_id
      left join public.customer_accounts c on c.id = s.user_id
      left join public.profiles p on p.id = s.user_id and p.removed_at is null
      left join public.admin_roles r on r.id = p.role_id
     where (s.not_after is null or s.not_after > now())
       and (v_q is null or c.member_id = v_q or u.email ilike '%' || v_q || '%' or coalesce(p.full_name, c.full_name) ilike '%' || v_q || '%')
     order by 9 desc
     limit 1000;
end;
$$;
revoke all on function public.admin_signed_in_users(text) from public, anon;
grant execute on function public.admin_signed_in_users(text) to authenticated;

-- Last sign-in of every account: in a date range, or before a date (not seen since).
create or replace function public.admin_last_sign_ins(
  p_from timestamptz default null, p_to timestamptz default null, p_before timestamptz default null, p_search text default null)
returns table (
  user_id uuid, member_id text, full_name text, email text, is_staff boolean, role_name text,
  last_sign_in_at timestamptz, created_at timestamptz, signed_in_now boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('security.manage');
  return query
    select u.id, c.member_id, coalesce(p.full_name, c.full_name), u.email::text, p.id is not null, r.name,
           u.last_sign_in_at, u.created_at,
           exists (select 1 from auth.sessions s where s.user_id = u.id and (s.not_after is null or s.not_after > now()))
      from auth.users u
      left join public.customer_accounts c on c.id = u.id
      left join public.profiles p on p.id = u.id and p.removed_at is null
      left join public.admin_roles r on r.id = p.role_id
     where (p_from is null or u.last_sign_in_at >= p_from) and (p_to is null or u.last_sign_in_at < p_to)
       and (p_before is null or u.last_sign_in_at is null or u.last_sign_in_at < p_before)
       and (v_q is null or c.member_id = v_q or u.email ilike '%' || v_q || '%' or coalesce(p.full_name, c.full_name) ilike '%' || v_q || '%')
     order by u.last_sign_in_at desc nulls last
     limit 2000;
end;
$$;
revoke all on function public.admin_last_sign_ins(timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_last_sign_ins(timestamptz, timestamptz, timestamptz, text) to authenticated;

-- Sign a user out everywhere (their tokens stop working at once: private.session_alive).
create or replace function public.admin_sign_out_user(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform private.require_permission('security.manage');
  if p_user_id = (select auth.uid()) then perform private.app_error('cannot_modify_self'); end if;
  if not exists (select 1 from auth.users where id = p_user_id) then perform private.app_error('user_not_found'); end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  perform private.audit('user_signed_out', case when exists (select 1 from public.profiles where id = p_user_id) then 'profiles' else 'customer_account' end,
    p_user_id::text, null, jsonb_build_object('sessions_ended', n), jsonb_build_object('user_id', private.member_of(p_user_id)));
  return n;
end;
$$;
revoke all on function public.admin_sign_out_user(uuid) from public, anon;
grant execute on function public.admin_sign_out_user(uuid) to authenticated;

-- ============================================================ 5. App installs
create table if not exists public.app_installs (
  device_id    uuid primary key,
  user_id      uuid references auth.users(id) on delete set null,
  platform     text not null check (platform in ('android', 'ios', 'windows', 'mac', 'linux', 'other')),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  opens        integer not null default 1
);
create index if not exists app_installs_user_idx on public.app_installs(user_id);
alter table public.app_installs enable row level security;
revoke all on public.app_installs from anon, authenticated;
-- No policies: written by the server (after validation + rate limiting), read through admin_app_installs().

create or replace function public.record_app_install(p_device_id uuid, p_platform text, p_user_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.app_installs (device_id, user_id, platform)
  values (p_device_id, p_user_id, case when p_platform in ('android', 'ios', 'windows', 'mac', 'linux') then p_platform else 'other' end)
  on conflict (device_id) do update
     set last_seen = now(), opens = public.app_installs.opens + 1,
         user_id = coalesce(excluded.user_id, public.app_installs.user_id),
         platform = excluded.platform
$$;
revoke all on function public.record_app_install(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_app_install(uuid, text, uuid) to service_role;

create or replace function public.admin_app_installs()
returns table (device_id uuid, user_id uuid, member_id text, full_name text, email text, is_staff boolean, platform text,
               first_seen timestamptz, last_seen timestamptz, opens integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('customers.view');
  return query
    select i.device_id, i.user_id, c.member_id, coalesce(p.full_name, c.full_name), u.email::text, p.id is not null, i.platform,
           i.first_seen, i.last_seen, i.opens
      from public.app_installs i
      left join auth.users u on u.id = i.user_id
      left join public.customer_accounts c on c.id = i.user_id
      left join public.profiles p on p.id = i.user_id
     order by i.last_seen desc
     limit 5000;
end;
$$;
revoke all on function public.admin_app_installs() from public, anon;
grant execute on function public.admin_app_installs() to authenticated;

-- ============================================================ 6. Printing: alerts after payment; rejected → files deleted
-- No staff alert when a printing request is created (only once its payment is submitted).
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
  return new;
end;
$$;

-- Documents go to the printing group as soon as the payment is submitted (or paid from the balance).
create or replace function private.printing_documents_on_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_i integer := 0;
  f record;
begin
  if new.status not in ('payment_verification', 'printing')
     or old.status in ('payment_verification', 'printing', 'ready', 'completed') then return null; end if;
  select count(*) into v_total from public.printing_files where job_id = new.id and deleted_at is null;
  for f in select * from public.printing_files where job_id = new.id and deleted_at is null order by created_at, id loop
    v_i := v_i + 1;
    perform private.enqueue_notification('printing_document', 'printing_document:' || f.id,
      jsonb_build_object('job_id', new.id, 'job_number', new.job_number, 'file_name', f.original_name, 'mime', f.mime_type,
        'size_bytes', f.size_bytes, 'pages', f.page_count, 'n', v_i, 'of', v_total,
        'stage', case when new.status = 'printing' then 'paid' else 'payment_submitted' end,
        'customer', new.customer_name, 'phone', new.customer_phone, 'color_mode', new.color_mode, 'paper_size', new.paper_size,
        'sides', new.sides, 'copies', new.copies, 'page_count', new.page_count, 'total_etb', new.total_etb,
        'fulfillment', new.fulfillment_method, 'notes', left(new.customer_notes, 300)),
      'printing-files', f.storage_path);
  end loop;
  return null;
end;
$$;

-- A cancelled job's documents are deleted right away (by the storage clean-up).
create or replace function private.printing_files_due_on_cancel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then new.files_delete_after := now(); end if;
  return new;
end;
$$;
drop trigger if exists printing_jobs_files_due_on_cancel on public.printing_jobs;
create trigger printing_jobs_files_due_on_cancel before update of status on public.printing_jobs
  for each row execute function private.printing_files_due_on_cancel();

-- Payment rejected on an order with printing: the printing job (and the order) are cancelled;
-- the customer uploads the documents again with a new request.
create or replace function private.cancel_printing_on_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'payment_rejected' or old.status = 'payment_rejected' then return null; end if;
  if not exists (select 1 from public.printing_jobs where order_id = new.id and status not in ('completed', 'cancelled')) then return null; end if;
  perform private.set_status_note('Payment rejected: printing documents deleted — please send a new printing request');
  update public.printing_jobs set status = 'cancelled' where order_id = new.id and status not in ('completed', 'cancelled');
  perform private.release_order_stock(new.id);
  perform private.set_status_note('Payment rejected — order with printing cancelled (documents deleted)');
  update public.orders set status = 'cancelled', cancelled_at = now() where id = new.id;
  return null;
end;
$$;
drop trigger if exists orders_cancel_printing_on_rejection on public.orders;
create trigger orders_cancel_printing_on_rejection after update of status on public.orders
  for each row execute function private.cancel_printing_on_rejection();

-- Files are only deleted once their Telegram copy has gone out (or could not be sent within 2 days).
create or replace function public.printing_files_due_for_deletion(p_limit integer default 200)
returns table (file_id uuid, job_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.job_id, f.storage_path
  from public.printing_files f
  join public.printing_jobs j on j.id = f.job_id
  where f.deleted_at is null
    and j.files_delete_after <= now()
    and j.status not in ('payment_verification', 'printing', 'ready')
    and not exists (select 1 from public.notifications_outbox o
                     where o.dedupe_key = 'printing_document:' || f.id and o.status in ('pending', 'processing')
                       and o.created_at > now() - interval '2 days')
  order by j.files_delete_after
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- ============================================================ 7. Support Telegram group
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
    when p_event in ('printing_document', 'printing_test') then 'printing'
    when p_event in ('support_ticket', 'support_reply', 'support_test') then 'support'
    else 'orders'
  end
$$;

create or replace function public.admin_queue_group_test(p_group text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  if p_group not in ('stock', 'receipts', 'printing', 'support') then perform private.app_error('invalid_request'); end if;
  perform private.enqueue_notification(p_group || '_test', p_group || '_test:' || gen_random_uuid(),
    jsonb_build_object('requested_by', private.actor_name(auth.uid()), 'requested_at', now()));
end;
$$;

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
     and event_type in ('security_event', 'security_alert', 'admin_action', 'notification_copy', 'receipt_record', 'stock_test', 'receipts_test',
                        'printing_document', 'printing_test', 'support_test')
     and created_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
