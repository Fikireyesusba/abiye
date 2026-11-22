-- 0053:
--   * A rejected payment cancels the order automatically (stock released, printing documents deleted).
--     The customer gets ONE message: "payment not verified — order cancelled" (with the reason).
--   * Exports of the signed-in users lists are recorded ('users').
--   * User ID → person lookup for the admin (admin_find_user).

-- ------------------------------------------------------------ payment rejected → order cancelled
drop trigger if exists orders_cancel_printing_on_rejection on public.orders;
drop function if exists private.cancel_printing_on_rejection();

create or replace function private.cancel_order_on_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'payment_rejected' or old.status = 'payment_rejected' then return null; end if;
  if exists (select 1 from public.printing_jobs where order_id = new.id and status not in ('completed', 'cancelled')) then
    perform private.set_status_note('Payment rejected: printing documents deleted');
    update public.printing_jobs set status = 'cancelled' where order_id = new.id and status not in ('completed', 'cancelled');
  end if;
  perform private.release_order_stock(new.id);
  perform private.set_status_note('Payment rejected — order cancelled automatically');
  update public.orders set status = 'cancelled', cancelled_at = now() where id = new.id;
  return null;
end;
$$;
revoke all on function private.cancel_order_on_rejection() from public, anon, authenticated;
create trigger orders_cancel_on_rejection after update of status on public.orders
  for each row execute function private.cancel_order_on_rejection();

-- One customer message for a rejection: the "payment rejected" one already says the order is cancelled.
create or replace function private.email_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_note text;
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_event := 'order_placed';
  elsif new.status is distinct from old.status then
    if new.status = 'cancelled' and old.status = 'payment_rejected' then return new; end if;
    v_event := case new.status
      when 'confirmed' then 'order_confirmed'
      when 'payment_rejected' then 'order_payment_rejected'
      when 'ready_for_pickup' then 'order_ready_for_pickup'
      when 'out_for_delivery' then 'order_out_for_delivery'
      when 'completed' then 'order_completed'
      when 'cancelled' then 'order_cancelled'
      when 'expired' then 'order_expired'
    end;
  end if;
  if v_event is null then return new; end if;
  if v_event = 'order_payment_rejected' then
    select s.review_note into v_note from public.payment_submissions s
     where s.order_id = new.id and s.status = 'rejected' order by s.reviewed_at desc limit 1;
  end if;
  perform private.enqueue_customer_email(
    'customer_' || v_event,
    'email:' || v_event || ':' || new.id || ':' || (select count(*) from public.order_status_history h where h.order_id = new.id),
    new.user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_id', new.id, 'order_number', new.order_number, 'total_etb', new.total_etb,
      'fulfillment', new.fulfillment_method, 'locale', new.locale, 'note', v_note,
      'payment_due_at', case when v_event = 'order_placed' then new.payment_due_at end,
      'bank', case when v_event = 'order_placed' then new.bank_snapshot end)));
  return new;
end;
$$;

-- Orders still waiting with a rejected payment (from before this change) are cancelled now.
do $$
declare r record;
begin
  for r in select id from public.orders where status = 'payment_rejected' loop
    perform private.set_status_note('Payment rejected — order cancelled automatically');
    if exists (select 1 from public.printing_jobs where order_id = r.id and status not in ('completed', 'cancelled')) then
      update public.printing_jobs set status = 'cancelled' where order_id = r.id and status not in ('completed', 'cancelled');
    end if;
    perform private.release_order_stock(r.id);
    update public.orders set status = 'cancelled', cancelled_at = now() where id = r.id;
  end loop;
end;
$$;

-- ------------------------------------------------------------ exports of the users lists are recorded
create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'orders' then perform private.require_permission('orders.view_all');
  elsif p_kind = 'activity' then perform private.require_permission('audit.view');
  elsif p_kind = 'payments' then perform private.require_permission('payments.view');
  elsif p_kind = 'sales' then perform private.require_permission('analytics.view');
  elsif p_kind = 'all' then perform private.require_permission('data.manage');
  elsif p_kind = 'notifications' then perform private.require_permission('settings.manage');
  elsif p_kind = 'users' then perform private.require_permission('security.manage');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;

-- ------------------------------------------------------------ User ID → person
create or replace function public.admin_find_user(p_member_id text)
returns table (user_id uuid, member_id text, is_staff boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission('customers.view') or private.has_permission('staff.manage')
          or private.has_permission('security.manage') or private.has_permission('support.view')) then
    perform private.app_error('forbidden');
  end if;
  return query
    select c.id, c.member_id, exists (select 1 from public.profiles p where p.id = c.id)
      from public.customer_accounts c
     where c.member_id = btrim(coalesce(p_member_id, ''));
end;
$$;
revoke all on function public.admin_find_user(text) from public, anon;
grant execute on function public.admin_find_user(text) to authenticated;
