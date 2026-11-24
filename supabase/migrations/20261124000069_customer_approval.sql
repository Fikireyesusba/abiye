-- =============================================================================
-- 0069 CUSTOMER ACCOUNT APPROVAL
--   * Every NEW customer account starts "Under verification" (pending). Existing accounts are approved.
--   * Pending customers can sign in, browse, see their account and use Support & feedback — but cannot
--     order, top up, use printing, write reviews or ask for stock alerts (refused in the database).
--   * Someone with the new permission customers.approve approves it, or rejects it with a reason:
--     the email is put on the block list (with the reason) and the app emails the customer and deletes
--     the account. Both are in the Activity log; new accounts are announced in the security group.
--   * Accounts invited by the shop (Admin → Customers → Invite) are approved at once.
-- =============================================================================

insert into public.admin_permissions (key, description)
values ('customers.approve', 'Approve or reject new customer accounts')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'customers.approve' from public.admin_roles r where r.key = 'super_admin'
on conflict do nothing;

-- Existing accounts: approved. New ones: pending (the column default changes after the backfill).
alter table public.customer_accounts
  add column approval_status text not null default 'approved' check (approval_status in ('pending', 'approved')),
  add column approved_at     timestamptz,
  add column approved_by     uuid references auth.users(id) on delete set null;
alter table public.customer_accounts alter column approval_status set default 'pending';
create index customer_accounts_pending_idx on public.customer_accounts (created_at) where approval_status = 'pending';
-- (Customers cannot change these columns: only full_name, phone, address, date of birth and sex are updatable.)

-- Buying / creating things needs an approved account (orders, printing, top-ups, reviews, stock alerts, personal codes).
create or replace function private.assert_confirmed_user(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = p_user_id and email_confirmed_at is not null;
  if p_user_id is null or v_email is null then
    perform private.app_error('login_required');
  end if;
  if not private.is_active_user(p_user_id) then
    perform private.app_error('account_deactivated');
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    perform private.app_error('staff_account');
  end if;
  if private.email_is_blocked(v_email) then
    perform private.app_error('email_blocked');
  end if;
  if exists (select 1 from public.customer_accounts where id = p_user_id and approval_status = 'pending') then
    perform private.app_error('account_pending');
  end if;
end;
$$;

-- New account → security group alert (User ID; the email is not shown).
create or replace function private.customer_pending_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.approval_status = 'pending' and not exists (select 1 from public.profiles where id = new.id) then
    perform private.enqueue_notification('account_pending', 'account_pending:' || new.id,
      jsonb_build_object('user_id', new.member_id, 'at', now()));
  end if;
  return null;
end;
$$;
create trigger customer_accounts_pending_alert after insert on public.customer_accounts
  for each row execute function private.customer_pending_alert();

-- Accounts waiting for a decision (approvers only).
create or replace function public.admin_pending_customers()
returns table (id uuid, member_id text, email text, full_name text, phone text, date_of_birth date, sex text,
               default_address text, email_confirmed boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('customers.approve');
  return query
    select c.id, c.member_id::text, u.email::text, c.full_name, c.phone, c.date_of_birth, c.sex::text, c.default_address,
           u.email_confirmed_at is not null, c.created_at, u.last_sign_in_at
      from public.customer_accounts c
      join auth.users u on u.id = c.id
     where c.approval_status = 'pending'
       and not exists (select 1 from public.profiles p where p.id = c.id)
     order by c.created_at
     limit 500;
end;
$$;

create or replace function public.admin_approve_customer(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.customer_accounts;
begin
  perform private.require_permission('customers.approve');
  select * into v from public.customer_accounts where id = p_user_id for update;
  if not found or exists (select 1 from public.profiles where id = p_user_id) then perform private.app_error('not_found'); end if;
  if v.approval_status <> 'pending' then perform private.app_error('invalid_transition'); end if;
  update public.customer_accounts set approval_status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_user_id;
  perform private.audit('account_approved', 'customer_account', p_user_id::text, null, null, jsonb_build_object('user_id', v.member_id));
  perform private.enqueue_customer_email('customer_account_approved', 'account_approved:' || p_user_id, p_user_id,
    jsonb_build_object('name', v.full_name));
end;
$$;

-- Reject: block the email with the reason and return what the app needs to email the customer and delete
-- the account (the app does both right after, with the secret key, only after this succeeded).
create or replace function public.admin_reject_customer(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.customer_accounts;
  v_email text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_permission('customers.approve');
  if char_length(v_reason) not between 5 and 500 then perform private.app_error('invalid_reason'); end if;
  select * into v from public.customer_accounts where id = p_user_id for update;
  if not found or exists (select 1 from public.profiles where id = p_user_id) then perform private.app_error('not_found'); end if;
  if v.approval_status <> 'pending' then perform private.app_error('invalid_transition'); end if;
  if exists (select 1 from public.orders where user_id = p_user_id) or exists (select 1 from public.wallet_topups where user_id = p_user_id) then
    perform private.app_error('has_orders');
  end if;
  select lower(email) into v_email from auth.users where id = p_user_id;
  insert into public.blocked_emails (email, reason) values (v_email, 'Account rejected: ' || left(v_reason, 480))
  on conflict (email) do update set reason = excluded.reason;
  perform private.audit('account_rejected', 'customer_account', p_user_id::text, null, null,
    jsonb_build_object('user_id', v.member_id, 'reason', v_reason));
  return jsonb_build_object('email', v_email, 'name', v.full_name, 'member_id', v.member_id);
end;
$$;

-- Accounts invited by the shop are approved at once (server only, after the inviting admin was checked).
create or replace function public.approve_invited_customer(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.customer_accounts set approval_status = 'approved', approved_at = now()
   where id = p_user_id and approval_status = 'pending'
$$;

revoke all on function public.admin_pending_customers() from public, anon;
revoke all on function public.admin_approve_customer(uuid) from public, anon;
revoke all on function public.admin_reject_customer(uuid, text) from public, anon;
revoke all on function public.approve_invited_customer(uuid) from public, anon, authenticated;
revoke all on function private.customer_pending_alert() from public;
grant execute on function public.admin_pending_customers() to authenticated;
grant execute on function public.admin_approve_customer(uuid) to authenticated;
grant execute on function public.admin_reject_customer(uuid, text) to authenticated;
grant execute on function public.approve_invited_customer(uuid) to service_role;

-- "New account waiting for approval" goes to the security group.
create or replace function private.telegram_group(p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event in ('security_event', 'security_alert', 'admin_action', 'security_test', 'promotion_alert', 'account_pending') then 'security'
    when p_event in ('low_stock', 'out_of_stock', 'stock_test') then 'stock'
    when p_event in ('receipt_record', 'receipts_test', 'excel_export') then 'receipts'
    when p_event in ('printing_document', 'printing_test') then 'printing'
    when p_event in ('support_ticket', 'support_reply', 'support_rating', 'support_test') then 'support'
    else 'orders'
  end
$$;
