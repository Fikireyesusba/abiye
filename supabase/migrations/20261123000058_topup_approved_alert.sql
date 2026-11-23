-- 0058: an approved wallet top-up is announced in the orders & payments Telegram group
-- ("✅ TOP-UP APPROVED"), like an approved order payment. (Since 0057 top-ups waiting for
-- approval are not alerted by default, so this is the top-up message staff see.)

create or replace function private.telegram_topup_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text <> 'verified' or old.status::text = 'verified' then return null; end if;
  perform private.enqueue_notification('topup_verified', 'topup_verified:' || new.id,
    jsonb_build_object('topup_id', new.id, 'number', new.topup_number, 'amount_etb', new.amount_etb,
      'reference', new.transaction_reference, 'user_id', private.member_of(new.user_id),
      'balance_etb', (select wallet_balance_etb from public.customer_accounts where id = new.user_id),
      'decided_by', private.actor_name(new.reviewed_by), 'decided_at', new.reviewed_at));
  return null;
end;
$$;
revoke all on function private.telegram_topup_approved() from public, anon, authenticated;

drop trigger if exists wallet_topups_telegram_approved on public.wallet_topups;
create trigger wallet_topups_telegram_approved after update of status on public.wallet_topups
  for each row execute function private.telegram_topup_approved();
