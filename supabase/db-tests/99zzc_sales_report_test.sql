-- Sales report: money counted on verification day (Addis Ababa), by bank, permissions
\ir _helpers.sql

-- two bank-transfer orders paid "today", one paid yesterday 23:30 Addis time (must not count today)
select public.create_order_for_user(:customer, pg_temp.order_payload(k, jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', :charger, 'quantity', 1))))
  from (values ('d2000000-0000-0000-0000-000000000001'::uuid), ('d2000000-0000-0000-0000-000000000002'::uuid), ('d2000000-0000-0000-0000-000000000003'::uuid)) v(k);
update public.orders set payment_status = 'verified', status = 'confirmed', payment_verified_by = :manager,
       payment_verified_at = ((now() at time zone 'Africa/Addis_Ababa')::date + time '10:00') at time zone 'Africa/Addis_Ababa'
 where idempotency_key in ('d2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002');
update public.orders set payment_status = 'verified', status = 'confirmed',
       payment_verified_at = ((now() at time zone 'Africa/Addis_Ababa')::date - 1 + time '23:30') at time zone 'Africa/Addis_Ababa'
 where idempotency_key = 'd2000000-0000-0000-0000-000000000003';
create temp table t_day as select (now() at time zone 'Africa/Addis_Ababa')::date as d;
grant select on t_day to authenticated;

select pg_temp.login(:manager);
select pg_temp.throws($$select public.admin_sales_report(current_date, current_date)$$, 'forbidden', 'managers cannot see money reports');
reset role;
select pg_temp.login(:super);
create temp table t_r as select public.admin_sales_report((select d from t_day), (select d from t_day)) as r;
reset role;
select pg_temp.ok((select (r -> 'totals' ->> 'orders_paid')::int from t_r) >= 2, 'orders paid today counted');
select pg_temp.ok((select (r -> 'totals' ->> 'sales')::numeric = (r -> 'totals' ->> 'paid_by_bank')::numeric + (r -> 'totals' ->> 'paid_by_wallet')::numeric from t_r),
                  'sales = paid by bank + paid with balance');
select pg_temp.ok((select (r -> 'totals' ->> 'sales')::numeric = (r -> 'totals' ->> 'products_sales')::numeric + (r -> 'totals' ->> 'printing_sales')::numeric
                          + (r -> 'totals' ->> 'delivery_fees')::numeric - (r -> 'totals' ->> 'discounts')::numeric from t_r),
                  'sales = products + printing + delivery − discounts');
select pg_temp.ok((select (r -> 'totals' ->> 'cash_in')::numeric = (r -> 'totals' ->> 'paid_by_bank')::numeric + (r -> 'totals' ->> 'topups_amount')::numeric from t_r),
                  'money into the bank = bank-paid orders + top-ups');
select pg_temp.ok((select sum((b ->> 'total')::numeric) from t_r, jsonb_array_elements(r -> 'by_bank') b) = (select (r -> 'totals' ->> 'cash_in')::numeric from t_r),
                  'per-bank totals add up');
select pg_temp.ok((select jsonb_array_length(r -> 'by_day') = 1 and (r -> 'by_day' -> 0 ->> 'sales')::numeric = (r -> 'totals' ->> 'sales')::numeric from t_r), 'one day, matching totals');
select pg_temp.ok((select count(*) from t_r, jsonb_array_elements(r -> 'by_staff') s where s ->> 'name' is not null) >= 1, 'who verified the payments');
select pg_temp.login(:super);
select pg_temp.ok((public.admin_sales_report((select d - 1 from t_day), (select d - 1 from t_day)) -> 'totals' ->> 'orders_paid')::int >= 1,
                  'payment verified at 23:30 Addis time counts on that day, not the next');
select pg_temp.throws($$select public.admin_sales_report(current_date, current_date - 1)$$, 'invalid_request', 'valid range only');
select pg_temp.throws($$select public.admin_sales_report(current_date - 400, current_date)$$, 'invalid_request', 'at most one year');
select public.admin_log_export('sales', '{"from":"x"}');
reset role;
select pg_temp.ok(exists (select 1 from public.audit_logs where action = 'export_sales'), 'sales export recorded');
