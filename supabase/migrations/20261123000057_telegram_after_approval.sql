-- 0057: Telegram only after a payment is approved.
--   * Printing documents go to the printing group once the payment is approved (job → printing).
--   * "Payment / top-up waiting for approval" alerts (new_order, payment_resubmitted, wallet_topup) are a switch,
--     OFF by default: staff see what is waiting in the admin (red counts); approved payments are still sent.

create or replace function private.feed_on(p_part text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.setting('telegram_feed') ->> p_part)::boolean,
                  p_part not in ('order_progress', 'notifications', 'pending_payments'))
$$;

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
  if new.event_type in ('new_order', 'payment_resubmitted', 'wallet_topup') and not private.feed_on('pending_payments') then return null; end if;
  return new;
end;
$$;

-- Documents once the payment is approved (or paid from the balance): job moves to "printing".
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
  if new.status <> 'printing' or old.status in ('printing', 'ready', 'completed') then return null; end if;
  select count(*) into v_total from public.printing_files where job_id = new.id and deleted_at is null;
  for f in select * from public.printing_files where job_id = new.id and deleted_at is null order by created_at, id loop
    v_i := v_i + 1;
    perform private.enqueue_notification('printing_document', 'printing_document:' || f.id,
      jsonb_build_object('job_id', new.id, 'job_number', new.job_number, 'file_name', f.original_name, 'mime', f.mime_type,
        'size_bytes', f.size_bytes, 'pages', f.page_count, 'n', v_i, 'of', v_total, 'stage', 'paid',
        'customer', new.customer_name, 'phone', new.customer_phone, 'color_mode', new.color_mode, 'paper_size', new.paper_size,
        'sides', new.sides, 'copies', new.copies, 'page_count', new.page_count, 'total_etb', new.total_etb,
        'fulfillment', new.fulfillment_method, 'notes', left(new.customer_notes, 300)),
      'printing-files', f.storage_path);
  end loop;
  return null;
end;
$$;

-- Saving the feed switches keeps the other parts (merge instead of replace).
create or replace function public.admin_set_telegram_feed(p_security boolean, p_admin boolean, p_notifications boolean,
                                                          p_order_progress boolean default false, p_printing_requests boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := jsonb_build_object('security', coalesce(p_security, true), 'admin', coalesce(p_admin, true),
                                'notifications', coalesce(p_notifications, false), 'order_progress', coalesce(p_order_progress, false),
                                'printing_requests', coalesce(p_printing_requests, true));
begin
  perform private.require_permission('settings.manage');
  insert into public.website_settings (key, value, is_public, updated_by) values ('telegram_feed', v, false, auth.uid())
  on conflict (key) do update set value = public.website_settings.value || excluded.value, is_public = false, updated_by = excluded.updated_by;
end;
$$;

create or replace function public.admin_set_pending_payment_alerts(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  insert into public.website_settings (key, value, is_public, updated_by)
  values ('telegram_feed', jsonb_build_object('pending_payments', coalesce(p_on, false)), false, auth.uid())
  on conflict (key) do update set value = public.website_settings.value || excluded.value, updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.admin_set_pending_payment_alerts(boolean) from public, anon;
grant execute on function public.admin_set_pending_payment_alerts(boolean) to authenticated;

create or replace function public.admin_telegram_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return jsonb_build_object('security', private.feed_on('security'), 'admin', private.feed_on('admin'),
                            'notifications', private.feed_on('notifications'), 'order_progress', private.feed_on('order_progress'),
                            'printing_requests', private.feed_on('printing_requests'), 'pending_payments', private.feed_on('pending_payments'));
end;
$$;

-- Off from now on (the owner's choice; can be switched on under Notifications).
insert into public.website_settings (key, value, is_public)
values ('telegram_feed', jsonb_build_object('pending_payments', false), false)
on conflict (key) do update set value = public.website_settings.value || jsonb_build_object('pending_payments', false);
