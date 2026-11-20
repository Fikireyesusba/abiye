-- =============================================================================
-- 0026 WALLET (shop credit)
--   * Customers top up by bank transfer + receipt; a Manager / Super Admin
--     (wallet.manage) verifies the money arrived, then the balance is credited.
--   * Maximum balance 10,000 ETB (top-ups and manual credits are refused above it).
--   * The balance can pay an order only if it covers the WHOLE total; such an
--     order is confirmed immediately (same transaction as the order).
--   * No withdrawals: cancelling a balance-paid order refunds the balance.
--   * Every change is a row in the append-only wallet_ledger; the current
--     balance lives on customer_accounts and can never go below 0.
-- =============================================================================

insert into public.admin_permissions (key, description) values
  ('wallet.manage', 'Verify wallet top-ups and see customer balances'),
  ('wallet.adjust', 'Correct a customer balance manually')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r join public.admin_permissions p on p.key in ('wallet.manage', 'wallet.adjust')
 where r.key = 'super_admin'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select id, 'wallet.manage' from public.admin_roles where key = 'manager'
on conflict do nothing;

create or replace function private.wallet_max()
returns numeric language sql immutable set search_path = '' as $$ select 10000::numeric $$;

alter table public.customer_accounts
  add column wallet_balance_etb numeric(12,2) not null default 0 check (wallet_balance_etb >= 0);

alter table public.orders
  add column payment_method text not null default 'bank_transfer' check (payment_method in ('bank_transfer', 'wallet'));

-- ---------------------------------------------------------------------------
-- Top-up requests
-- ---------------------------------------------------------------------------
create sequence public.wallet_topup_number_seq start 1001;
create table public.wallet_topups (
  id                    uuid primary key default gen_random_uuid(),
  topup_number          text not null unique default ('TU-' || nextval('public.wallet_topup_number_seq')),
  user_id               uuid not null references auth.users(id) on delete restrict,
  amount_etb            numeric(12,2) not null check (amount_etb >= 10 and amount_etb <= 10000),
  transaction_reference text check (transaction_reference ~ '^[A-Za-z0-9/_ -]{3,60}$'),
  receipt_path          text not null unique check (receipt_path ~ '^topups/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$'),
  receipt_mime          text not null check (receipt_mime in ('image/jpeg', 'image/png', 'application/pdf')),
  receipt_size_bytes    integer not null check (receipt_size_bytes between 1 and 10485760),
  receipt_sha256        text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  bank_snapshot         jsonb,
  status                text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  review_note           text check (char_length(review_note) <= 1000),
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  check ((status = 'pending') = (reviewed_at is null)),
  check (status <> 'rejected' or review_note is not null)
);
create index wallet_topups_user_idx on public.wallet_topups(user_id, created_at desc);
create index wallet_topups_pending_idx on public.wallet_topups(created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Ledger (append-only)
-- ---------------------------------------------------------------------------
create table public.wallet_ledger (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id) on delete restrict,
  amount_etb        numeric(12,2) not null check (amount_etb <> 0),
  balance_after_etb numeric(12,2) not null check (balance_after_etb >= 0),
  kind              text not null check (kind in ('topup', 'order_payment', 'refund', 'adjustment')),
  topup_id          uuid references public.wallet_topups(id) on delete restrict,
  order_id          uuid references public.orders(id) on delete restrict,
  note              text check (char_length(note) <= 500),
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index wallet_ledger_user_idx on public.wallet_ledger(user_id, id desc);

create or replace function private.prevent_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'wallet_ledger is append-only';
end;
$$;
create trigger wallet_ledger_immutable before update or delete on public.wallet_ledger
  for each row execute function private.prevent_ledger_mutation();

-- RLS: customers read their own; wallet.manage reads all; nobody writes directly.
alter table public.wallet_topups enable row level security;
alter table public.wallet_ledger enable row level security;
revoke all on public.wallet_topups, public.wallet_ledger from anon, authenticated;
grant select on public.wallet_topups, public.wallet_ledger to authenticated;
create policy wallet_topups_own_read on public.wallet_topups for select to authenticated
  using (user_id = (select auth.uid()));
create policy wallet_topups_admin_read on public.wallet_topups for select to authenticated
  using ((select private.has_permission('wallet.manage')));
create policy wallet_ledger_own_read on public.wallet_ledger for select to authenticated
  using (user_id = (select auth.uid()));
create policy wallet_ledger_admin_read on public.wallet_ledger for select to authenticated
  using ((select private.has_permission('wallet.manage')));

-- Wallet managers can open top-up receipts (signed URLs).
create policy "topup receipts: wallet managers read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts' and name like 'topups/%' and (select private.has_permission('wallet.manage')));

-- ---------------------------------------------------------------------------
-- Core: move money (locks the account row; balance can never go below 0)
-- ---------------------------------------------------------------------------
create or replace function private.wallet_post(
  p_user uuid, p_amount numeric, p_kind text, p_topup uuid default null, p_order uuid default null, p_note text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric(12,2);
begin
  insert into public.customer_accounts (id) values (p_user) on conflict do nothing;
  select wallet_balance_etb into v_balance from public.customer_accounts where id = p_user for update;
  v_balance := v_balance + p_amount;
  if v_balance < 0 then perform private.app_error('wallet_insufficient'); end if;
  update public.customer_accounts set wallet_balance_etb = v_balance where id = p_user;
  insert into public.wallet_ledger (user_id, amount_etb, balance_after_etb, kind, topup_id, order_id, note)
  values (p_user, p_amount, v_balance, p_kind, p_topup, p_order, left(p_note, 500));
  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer: request a top-up (server only, after the receipt was verified by content)
-- p_input = { amount_etb, transaction_reference?, receipt: { path, mime, size, sha256 } }
-- ---------------------------------------------------------------------------
create or replace function public.submit_wallet_topup(p_user_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount   numeric;
  v_ref      text := nullif(btrim(coalesce(p_input ->> 'transaction_reference', '')), '');
  v_balance  numeric;
  v_pending  numeric;
  v_count    integer;
  v_bank     public.bank_accounts;
  v_topup    public.wallet_topups;
  v_seen     boolean;
begin
  perform private.assert_confirmed_user(p_user_id);
  if coalesce(p_input ->> 'amount_etb', '') !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' then perform private.app_error('invalid_amount'); end if;
  v_amount := (p_input ->> 'amount_etb')::numeric;
  if v_amount < 10 or v_amount > private.wallet_max() then perform private.app_error('invalid_amount'); end if;
  if v_ref is not null and v_ref !~ '^[A-Za-z0-9/_ -]{3,60}$' then perform private.app_error('invalid_reference'); end if;
  if coalesce(p_input #>> '{receipt,path}', '') !~ ('^topups/' || p_user_id || '/[0-9a-f-]{36}\.(jpg|png|pdf)$') then
    perform private.app_error('upload_failed');
  end if;

  -- Serialize this customer's top-ups so the limit check cannot be raced.
  perform 1 from public.customer_accounts where id = p_user_id for update;
  select coalesce(wallet_balance_etb, 0) into v_balance from public.customer_accounts where id = p_user_id;
  select coalesce(sum(amount_etb), 0), count(*) into v_pending, v_count
    from public.wallet_topups where user_id = p_user_id and status = 'pending';
  if v_count >= 3 then perform private.app_error('topup_pending_limit'); end if;
  if coalesce(v_balance, 0) + v_pending + v_amount > private.wallet_max() then
    perform private.app_error('wallet_limit', greatest(0, private.wallet_max() - coalesce(v_balance, 0) - v_pending)::text);
  end if;

  select * into v_bank from public.bank_accounts where is_active order by sort_order, created_at limit 1;
  v_seen := (v_ref is not null and (
               exists (select 1 from public.payment_submissions s where lower(s.transaction_reference) = lower(v_ref))
            or exists (select 1 from public.wallet_topups t where lower(t.transaction_reference) = lower(v_ref))))
         or exists (select 1 from public.payment_submissions s where s.receipt_sha256 = p_input #>> '{receipt,sha256}')
         or exists (select 1 from public.wallet_topups t where t.receipt_sha256 = p_input #>> '{receipt,sha256}');

  insert into public.wallet_topups (user_id, amount_etb, transaction_reference, receipt_path, receipt_mime, receipt_size_bytes, receipt_sha256, bank_snapshot)
  values (p_user_id, v_amount, v_ref, p_input #>> '{receipt,path}', p_input #>> '{receipt,mime}', (p_input #>> '{receipt,size}')::integer,
          p_input #>> '{receipt,sha256}',
          case when v_bank.id is not null then jsonb_build_object('bank_name', v_bank.bank_name, 'account_number', v_bank.account_number) end)
  returning * into v_topup;

  perform private.enqueue_notification('wallet_topup', 'wallet_topup:' || v_topup.id,
    jsonb_build_object('topup_number', v_topup.topup_number, 'amount_etb', v_amount,
      'customer', (select coalesce(c.full_name, u.email::text) from auth.users u left join public.customer_accounts c on c.id = u.id where u.id = p_user_id),
      'transaction_reference', v_ref, 'reference_seen_before', v_seen),
    'payment-receipts', v_topup.receipt_path);
  return jsonb_build_object('topup_id', v_topup.id, 'topup_number', v_topup.topup_number, 'reference_seen_before', v_seen);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: verify / reject a top-up
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_topup(p_topup_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       public.wallet_topups;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_bal   numeric;
begin
  perform private.require_permission('wallet.manage');
  select * into v from public.wallet_topups where id = p_topup_id;
  if not found then perform private.app_error('not_found'); end if;
  perform 1 from public.customer_accounts where id = v.user_id for update;
  select * into v from public.wallet_topups where id = p_topup_id for update;
  if v.status <> 'pending' then perform private.app_error('already_reviewed'); end if;

  if p_decision = 'verified' then
    if (select coalesce(wallet_balance_etb, 0) from public.customer_accounts where id = v.user_id) + v.amount_etb > private.wallet_max() then
      perform private.app_error('wallet_limit');
    end if;
    v_bal := private.wallet_post(v.user_id, v.amount_etb, 'topup', v.id, null, coalesce(v_note, 'Top-up ' || v.topup_number));
    update public.wallet_topups set status = 'verified', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = v_note where id = v.id;
  elsif p_decision = 'rejected' then
    if v_note is null then perform private.app_error('note_required'); end if;
    update public.wallet_topups set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = v_note where id = v.id;
    select wallet_balance_etb into v_bal from public.customer_accounts where id = v.user_id;
  else
    perform private.app_error('invalid_decision');
  end if;

  perform private.audit('topup_' || p_decision, 'customer_account', v.user_id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object('topup_number', v.topup_number, 'amount_etb', v.amount_etb, 'reason', v_note)));
  perform private.enqueue_customer_email('customer_topup_' || p_decision, 'topup:' || v.id || ':' || p_decision, v.user_id,
    jsonb_strip_nulls(jsonb_build_object('topup_number', v.topup_number, 'amount_etb', v.amount_etb, 'balance_etb', v_bal, 'note', v_note)));
  return jsonb_build_object('balance_etb', v_bal);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: manual correction (Super Admin), with a reason
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_wallet(p_user_id uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_bal    numeric;
begin
  perform private.require_permission('wallet.adjust');
  perform private.assert_manageable_customer(p_user_id);
  if p_amount is null or p_amount = 0 or abs(p_amount) > private.wallet_max() or p_amount <> round(p_amount, 2) then
    perform private.app_error('invalid_amount');
  end if;
  if v_reason is null or char_length(v_reason) > 500 then perform private.app_error('invalid_reason'); end if;
  perform 1 from public.customer_accounts where id = p_user_id for update;
  if p_amount > 0 and (select coalesce(wallet_balance_etb, 0) from public.customer_accounts where id = p_user_id) + p_amount > private.wallet_max() then
    perform private.app_error('wallet_limit');
  end if;
  v_bal := private.wallet_post(p_user_id, p_amount, 'adjustment', null, null, v_reason);
  perform private.audit('wallet_adjusted', 'customer_account', p_user_id::text, null, null,
    jsonb_build_object('amount_etb', p_amount, 'balance_etb', v_bal, 'reason', v_reason));
  return jsonb_build_object('balance_etb', v_bal);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pay an order with the balance (whole total only), inside checkout
-- ---------------------------------------------------------------------------
create or replace function private.pay_order_from_wallet(p_order_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.orders;
begin
  select * into v from public.orders where id = p_order_id for update;
  if not found or v.user_id is distinct from p_user then perform private.app_error('order_not_found'); end if;
  if v.payment_status = 'verified' and v.payment_method = 'wallet' then return; end if; -- idempotent replay
  if v.status <> 'awaiting_payment' or v.payment_status <> 'unpaid' then perform private.app_error('payment_not_allowed'); end if;
  perform private.wallet_post(p_user, -v.total_etb, 'order_payment', null, v.id, 'Order ' || v.order_number);
  perform private.set_status_note('Paid with account balance');
  update public.orders
     set status = 'confirmed', payment_status = 'verified', payment_method = 'wallet', payment_verified_at = now()
   where id = v.id;
  update public.printing_jobs set status = 'printing'
   where order_id = v.id and status in ('awaiting_payment', 'payment_verification');
  -- The "please pay by bank transfer" messages queued a moment ago no longer apply.
  delete from public.notifications_outbox
   where status = 'pending' and event_type = 'customer_order_placed' and payload ->> 'order_id' = v.id::text;
  -- Staff: a new paid order to prepare.
  perform private.enqueue_notification('wallet_order_paid', 'wallet_order:' || v.id,
    jsonb_build_object('order_id', v.id, 'order_number', v.order_number, 'total_etb', v.total_etb,
      'customer_name', v.customer_name, 'customer_phone', v.customer_phone, 'fulfillment_method', v.fulfillment_method,
      'city', v.city, 'address_line', v.address_line,
      'items', (select jsonb_agg(jsonb_build_object('name', i.name_en, 'quantity', i.quantity)) from public.order_items i where i.order_id = v.id)));
end;
$$;

create or replace function public.create_order_for_user(p_user_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders;
  v_result jsonb;
begin
  perform private.assert_confirmed_user(p_user_id);
  -- An idempotent replay must come from the same account.
  select * into v_existing from public.orders where idempotency_key = (p_input ->> 'idempotency_key')::uuid;
  if found and v_existing.user_id is distinct from p_user_id then
    perform private.app_error('idempotency_conflict');
  end if;
  -- Retry of a checkout that was already paid with the balance: same order, fresh access tokens, no second charge.
  if found and v_existing.payment_method = 'wallet' then
    update public.orders
       set access_token_hash = p_input ->> 'access_token_hash', tracking_code_hash = p_input ->> 'tracking_code_hash'
     where id = v_existing.id;
    return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
                              'total_etb', v_existing.total_etb, 'replayed', true, 'paid_with_wallet', true);
  end if;
  perform set_config('app.ordering_user_id', p_user_id::text, true);
  v_result := public.create_order(p_input);
  -- Clear immediately so nothing later in the same transaction inherits this user.
  perform set_config('app.ordering_user_id', '', true);
  delete from public.customer_carts where user_id = p_user_id;
  -- Pay with the account balance: all or nothing (an insufficient balance cancels the whole checkout).
  if p_input ->> 'payment_method' = 'wallet' then
    perform private.pay_order_from_wallet((v_result ->> 'order_id')::uuid, p_user_id);
    v_result := v_result || jsonb_build_object('paid_with_wallet', true);
  end if;
  return v_result;
end;
$$;

-- Cancelling a balance-paid order refunds the balance (no cash withdrawals).
create or replace function private.refund_wallet_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.payment_method = 'wallet' and old.payment_status = 'verified' then
    perform private.wallet_post(new.user_id, new.total_etb, 'refund', null, new.id, 'Refund: order ' || new.order_number || ' cancelled');
    new.payment_status := 'refunded';
  end if;
  return new;
end;
$$;
create trigger orders_wallet_refund before update of status on public.orders
  for each row execute function private.refund_wallet_order();

-- Top-up receipts are attached uploads too: never treat them as orphans.
create or replace function public.storage_orphans(p_min_age interval default '1 day', p_limit integer default 500)
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.created_at < now() - greatest(p_min_age, interval '6 hours')
     and (
       (o.bucket_id = 'payment-receipts'
          and not exists (select 1 from public.payment_submissions s where s.receipt_path = o.name)
          and not exists (select 1 from public.wallet_topups t where t.receipt_path = o.name))
       or (o.bucket_id = 'printing-files'
          and not exists (select 1 from public.printing_files f where f.storage_path = o.name)))
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

-- Admin overview of balances (customers with money, newest activity first).
create or replace function public.admin_wallet_balances(p_search text default null, p_limit integer default 100)
returns table (user_id uuid, email text, full_name text, balance_etb numeric, last_activity timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_permission('wallet.manage');
  return query
    select c.id, u.email::text, c.full_name, c.wallet_balance_etb,
           (select max(l.created_at) from public.wallet_ledger l where l.user_id = c.id)
      from public.customer_accounts c join auth.users u on u.id = c.id
     where (c.wallet_balance_etb > 0 or exists (select 1 from public.wallet_ledger l where l.user_id = c.id))
       and (v_q is null or u.email ilike '%' || v_q || '%' or c.full_name ilike '%' || v_q || '%')
     order by 5 desc nulls last
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.submit_wallet_topup(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_wallet_topup(uuid, jsonb) to service_role;
revoke execute on function public.admin_review_topup(uuid, text, text) from public, anon;
revoke execute on function public.admin_adjust_wallet(uuid, numeric, text) from public, anon;
revoke execute on function public.admin_wallet_balances(text, integer) from public, anon;
grant execute on function public.admin_review_topup(uuid, text, text) to authenticated;
grant execute on function public.admin_adjust_wallet(uuid, numeric, text) to authenticated;
grant execute on function public.admin_wallet_balances(text, integer) to authenticated;
