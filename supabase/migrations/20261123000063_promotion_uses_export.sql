-- 0063: Excel of promotion uses (Super Admin only): every order paid with a promo code — who (User ID),
-- which order, the price before the discount, the discount and the price paid. For complaints.

create or replace function public.admin_promotion_uses(p_from timestamptz, p_to timestamptz, p_limit integer default 5000)
returns table (order_number text, member_id text, code text, promotion text, audience text, discount_rule text,
               items text, subtotal_etb numeric, delivery_fee_etb numeric, original_total_etb numeric, discount_etb numeric,
               total_etb numeric, payment_method text, order_status text, ordered_at timestamptz, paid_at timestamptz,
               promotion_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('promotions.manage');
  if p_from is null or p_to is null or p_to <= p_from then perform private.app_error('invalid_request'); end if;
  return query
    select o.order_number::text, c.member_id::text, p.code::text, p.title_en,
           case when p.restricted then 'Selected customers' else 'Every customer' end,
           case when p.discount_type = 'percent' then trim(to_char(p.discount_value, 'FM990.##')) || '% off'
                else trim(to_char(p.discount_value, 'FM999999990.##')) || ' ETB off' end,
           (select string_agg(i.quantity || ' × ' || i.name_en || ' (' || i.unit_price_etb || ' ETB)', '; ' order by i.created_at)
              from public.order_items i where i.order_id = o.id),
           o.subtotal_etb, o.delivery_fee_etb, o.subtotal_etb + o.delivery_fee_etb, o.discount_etb, o.total_etb,
           o.payment_method::text, o.status::text, o.created_at, o.payment_verified_at,
           case when p.revoked_at is not null then 'Revoked' when p.is_active then 'Active' else 'Off' end
      from public.orders o
      join public.promotions p on p.id = o.promotion_id
      left join public.customer_accounts c on c.id = o.user_id
     where o.payment_verified_at is not null
       and o.payment_verified_at >= p_from and o.payment_verified_at < p_to
     order by o.payment_verified_at
     limit greatest(1, least(coalesce(p_limit, 5000), 20000));
end;
$$;
revoke all on function public.admin_promotion_uses(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_promotion_uses(timestamptz, timestamptz, integer) to authenticated;

create or replace function public.admin_log_export(p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Excel downloads are for the Super Admin only.
  if coalesce(private.current_role_key(), '') <> 'super_admin' or not private.mfa_verified() then perform private.app_error('forbidden'); end if;
  if p_kind = 'orders' then perform private.require_permission('orders.view_all');
  elsif p_kind = 'activity' then perform private.require_permission('audit.view');
  elsif p_kind = 'payments' then perform private.require_permission('payments.view');
  elsif p_kind = 'sales' then perform private.require_permission('analytics.view');
  elsif p_kind = 'all' then perform private.require_permission('data.manage');
  elsif p_kind = 'notifications' then perform private.require_permission('settings.manage');
  elsif p_kind = 'users' then perform private.require_permission('security.manage');
  elsif p_kind = 'support' then perform private.require_permission('support.view');
  elsif p_kind = 'customers' then perform private.require_permission('customers.view');
  elsif p_kind = 'products' then perform private.require_permission('products.view');
  elsif p_kind = 'wallet' then perform private.require_permission('wallet.manage');
  elsif p_kind = 'printing' then perform private.require_permission('printing.view');
  elsif p_kind = 'kpi' then perform private.require_permission('kpi.view');
  elsif p_kind = 'promotions' then perform private.require_permission('promotions.manage');
  else perform private.app_error('invalid_request');
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or length(p_metadata::text) > 2000 then
    perform private.app_error('invalid_request');
  end if;
  perform private.audit('export_' || p_kind, 'export', null, null, null, p_metadata);
end;
$$;
