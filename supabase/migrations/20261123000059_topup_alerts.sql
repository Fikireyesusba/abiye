-- 0059: wallet top-ups in the orders & payments Telegram group at every step:
--   * "Top-up to verify" as soon as the customer attaches the receipt (always on; the
--     "waiting for approval" switch now covers order payments only),
--   * "Top-up approved" (0058) and "Top-up rejected" (with the reason).

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
  if new.event_type in ('new_order', 'payment_resubmitted') and not private.feed_on('pending_payments') then return null; end if;
  return new;
end;
$$;

create or replace function private.telegram_topup_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text not in ('verified', 'rejected') or old.status::text = new.status::text then return null; end if;
  perform private.enqueue_notification(case when new.status::text = 'verified' then 'topup_verified' else 'topup_rejected' end,
    'topup_' || new.status::text || ':' || new.id,
    jsonb_build_object('topup_id', new.id, 'number', new.topup_number, 'amount_etb', new.amount_etb,
      'reference', new.transaction_reference, 'user_id', private.member_of(new.user_id),
      'balance_etb', (select wallet_balance_etb from public.customer_accounts where id = new.user_id),
      'decided_by', private.actor_name(new.reviewed_by), 'decided_at', new.reviewed_at, 'reason', new.review_note));
  return null;
end;
$$;
