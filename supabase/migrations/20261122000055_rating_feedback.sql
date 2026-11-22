-- 0055: a ticket rating (stars + the customer's feedback) is recorded in the activity log and
-- sent to the support Telegram group.

create or replace function public.customer_rate_ticket(p_ticket_id uuid, p_rating integer, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.support_tickets;
  v_comment text := nullif(left(btrim(coalesce(p_comment, '')), 500), '');
begin
  if not private.is_active_customer() then perform private.app_error('login_required'); end if;
  if p_rating is null or p_rating not between 1 and 5 then perform private.app_error('invalid_request', 'rating'); end if;
  select * into v_t from public.support_tickets where id = p_ticket_id and user_id = (select auth.uid()) for update;
  if not found or (v_t.status = 'closed' and v_t.closed_at <= now() - interval '24 hours') then perform private.app_error('not_found'); end if;
  if v_t.status not in ('resolved', 'closed') then perform private.app_error('invalid_transition', v_t.status); end if;
  if v_t.rating is not null then perform private.app_error('already_reviewed'); end if;
  update public.support_tickets set rating = p_rating, rating_comment = v_comment, rated_at = now() where id = v_t.id;
  perform private.audit('ticket_rated', 'support_ticket', v_t.id::text, null,
    jsonb_build_object('rating', p_rating, 'feedback', v_comment), jsonb_build_object('ticket_number', v_t.ticket_number));
  perform private.enqueue_notification('support_rating', 'support_rating:' || v_t.id,
    jsonb_build_object('ticket_id', v_t.id, 'number', v_t.ticket_number, 'subject', v_t.subject, 'rating', p_rating, 'feedback', v_comment,
      'user_id', private.member_of(v_t.user_id), 'assigned', private.actor_name(v_t.assigned_to)));
end;
$$;

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
    when p_event in ('support_ticket', 'support_reply', 'support_rating', 'support_test') then 'support'
    else 'orders'
  end
$$;
