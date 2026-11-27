-- =============================================================================
-- 0078 MONITORING ALERTS FROM GRAFANA
--   Switch (Admin → Notifications, settings.manage): "Monitoring alerts are sent by Grafana". When on, the website
--   stops sending its own Telegram copies of the threshold alerts Grafana now sends: late deliveries,
--   wrong PINs, documents expiring, low / out of stock. Event messages (payments with receipts, printing documents,
--   support, Excel files, delivery steps, security events) are still sent by the website.
-- =============================================================================

insert into public.website_settings (key, value, is_public) values ('monitoring', '{"grafana_alerts": false}', false)
on conflict (key) do nothing;

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
  -- Monitoring alerts handed over to Grafana (no duplicates).
  if new.event_type in ('delivery_alert', 'delivery_pin_alert', 'document_expiry', 'low_stock', 'out_of_stock')
     and coalesce((private.setting('monitoring') ->> 'grafana_alerts')::boolean, false) then
    return null;
  end if;
  if new.event_type in ('new_order', 'payment_resubmitted') then
    -- Printing orders are marked (own title in Telegram) and always announced.
    if exists (select 1 from public.order_items i
                where i.order_id = case when coalesce(new.payload ->> 'order_id', '') ~ '^[0-9a-fA-F-]{36}$' then (new.payload ->> 'order_id')::uuid end
                  and i.item_type = 'printing') then
      new.payload := new.payload || jsonb_build_object('printing', true);
    elsif not private.feed_on('pending_payments') then
      return null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_grafana_alerts(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  insert into public.website_settings (key, value, is_public) values ('monitoring', jsonb_build_object('grafana_alerts', coalesce(p_on, false)), false)
  on conflict (key) do update set value = public.website_settings.value || jsonb_build_object('grafana_alerts', coalesce(p_on, false));
  perform private.audit('grafana_alerts_set', 'website_settings', 'monitoring', null, null, jsonb_build_object('grafana_alerts', coalesce(p_on, false)));
end;
$$;
revoke all on function public.admin_set_grafana_alerts(boolean) from public, anon;
grant execute on function public.admin_set_grafana_alerts(boolean) to authenticated;
