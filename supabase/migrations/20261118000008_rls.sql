-- =============================================================================
-- 0008 ROW LEVEL SECURITY + TABLE PRIVILEGES
-- Model:
--   anon / authenticated  -> may READ the public catalog only.
--   authenticated admins  -> READ according to permissions; WRITE only simple
--                            catalog/config tables. Orders, payments, stock and
--                            printing jobs change ONLY through SECURITY DEFINER
--                            functions (0007), never by direct UPDATE.
--   service_role          -> server-only (bypasses RLS). Never sent to browsers.
-- NOTE: disable public sign-ups in Supabase Auth. Even so, a signed-in user
-- without an active profile is treated exactly like anon.
-- =============================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema public from anon, authenticated;

-- Non-SECURITY-DEFINER triggers raise app errors as the invoking role.
grant execute on function private.app_error(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public catalog
-- ---------------------------------------------------------------------------
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
create policy categories_public_read on public.categories for select to anon, authenticated
  using (is_active);
create policy categories_admin_read on public.categories for select to authenticated
  using ((select private.has_permission('products.view')));
create policy categories_admin_insert on public.categories for insert to authenticated
  with check ((select private.has_permission('categories.manage')));
create policy categories_admin_update on public.categories for update to authenticated
  using ((select private.has_permission('categories.manage')))
  with check ((select private.has_permission('categories.manage')));
create policy categories_admin_delete on public.categories for delete to authenticated
  using ((select private.has_permission('categories.manage')));

-- Products: anon gets a column subset; stock_quantity can only change through
-- admin_adjust_stock()/orders (column-level UPDATE grant excludes it).
grant select (id, slug, sku, name_en, name_am, description_en, description_am, brand, category_id,
              price_etb, sale_price_etb, stock_quantity, track_inventory, status, is_featured,
              created_at, updated_at)
  on public.products to anon;
grant select on public.products to authenticated;
grant insert (slug, sku, name_en, name_am, description_en, description_am, brand, category_id,
              price_etb, sale_price_etb, stock_quantity, low_stock_threshold, track_inventory,
              status, is_featured, created_by, updated_by)
  on public.products to authenticated;
grant update (slug, sku, name_en, name_am, description_en, description_am, brand, category_id,
              price_etb, sale_price_etb, low_stock_threshold, track_inventory, status, is_featured,
              updated_by)
  on public.products to authenticated;
grant delete on public.products to authenticated;
create policy products_public_read on public.products for select to anon, authenticated
  using (status = 'active');
create policy products_admin_read on public.products for select to authenticated
  using ((select private.has_permission('products.view')));
create policy products_admin_insert on public.products for insert to authenticated
  with check ((select private.has_permission('products.manage')));
create policy products_admin_update on public.products for update to authenticated
  using ((select private.has_permission('products.manage')))
  with check ((select private.has_permission('products.manage')));
-- Hard delete only succeeds for products never ordered (FK RESTRICT); archive otherwise.
create policy products_admin_delete on public.products for delete to authenticated
  using ((select private.has_permission('products.manage')));

grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;
create policy product_images_public_read on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.status = 'active'));
create policy product_images_admin_read on public.product_images for select to authenticated
  using ((select private.has_permission('products.view')));
create policy product_images_admin_write on public.product_images for all to authenticated
  using ((select private.has_permission('products.manage')))
  with check ((select private.has_permission('products.manage')));

grant select on public.delivery_zones to anon, authenticated;
grant insert, update, delete on public.delivery_zones to authenticated;
create policy delivery_zones_public_read on public.delivery_zones for select to anon, authenticated
  using (is_active);
create policy delivery_zones_admin on public.delivery_zones for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

grant select on public.website_settings to anon, authenticated;
grant insert, update on public.website_settings to authenticated;
create policy website_settings_public_read on public.website_settings for select to anon, authenticated
  using (is_public);
create policy website_settings_admin_read on public.website_settings for select to authenticated
  using ((select private.has_permission('settings.manage')));
create policy website_settings_admin_insert on public.website_settings for insert to authenticated
  with check ((select private.has_permission('settings.manage')));
create policy website_settings_admin_update on public.website_settings for update to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;
create policy promotions_public_read on public.promotions for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy promotions_admin on public.promotions for all to authenticated
  using ((select private.has_permission('promotions.manage')))
  with check ((select private.has_permission('promotions.manage')));

grant select on public.homepage_banners to anon, authenticated;
grant insert, update, delete on public.homepage_banners to authenticated;
create policy homepage_banners_public_read on public.homepage_banners for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy homepage_banners_admin on public.homepage_banners for all to authenticated
  using ((select private.has_permission('promotions.manage')))
  with check ((select private.has_permission('promotions.manage')));

grant select on public.printing_price_rules to anon, authenticated;
grant insert, update, delete on public.printing_price_rules to authenticated;
create policy printing_price_rules_public_read on public.printing_price_rules for select to anon, authenticated
  using (is_active);
create policy printing_price_rules_admin_read on public.printing_price_rules for select to authenticated
  using ((select private.has_permission('printing.view')));
create policy printing_price_rules_admin_write on public.printing_price_rules for all to authenticated
  using ((select private.has_permission('printing.pricing')))
  with check ((select private.has_permission('printing.pricing')));

-- ---------------------------------------------------------------------------
-- Admin-only configuration
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.bank_accounts to authenticated;
create policy bank_accounts_admin_read on public.bank_accounts for select to authenticated
  using ((select private.has_permission('bank_accounts.manage')) or (select private.has_permission('payments.view')));
create policy bank_accounts_admin_insert on public.bank_accounts for insert to authenticated
  with check ((select private.has_permission('bank_accounts.manage')));
create policy bank_accounts_admin_update on public.bank_accounts for update to authenticated
  using ((select private.has_permission('bank_accounts.manage')))
  with check ((select private.has_permission('bank_accounts.manage')));
create policy bank_accounts_admin_delete on public.bank_accounts for delete to authenticated
  using ((select private.has_permission('bank_accounts.manage')));

grant select on public.admin_roles, public.admin_permissions, public.role_permissions to authenticated;
create policy admin_roles_read on public.admin_roles for select to authenticated using ((select private.is_admin()));
create policy admin_permissions_read on public.admin_permissions for select to authenticated using ((select private.is_admin()));
create policy role_permissions_read on public.role_permissions for select to authenticated using ((select private.is_admin()));

grant select on public.profiles to authenticated;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_admin_read on public.profiles for select to authenticated
  using ((select private.has_permission('staff.manage')) or (select private.has_permission('orders.manage')));

-- ---------------------------------------------------------------------------
-- Customers, orders, payments (read-only for admins; writes via functions)
-- ---------------------------------------------------------------------------
grant select on public.customers, public.addresses to authenticated;
create policy customers_admin_read on public.customers for select to authenticated
  using ((select private.has_permission('customers.view')));
create policy addresses_admin_read on public.addresses for select to authenticated
  using ((select private.has_permission('customers.view')));

grant select on public.orders to authenticated;
create policy orders_admin_read on public.orders for select to authenticated
  using ((select private.has_permission('orders.view_all'))
         or (assigned_to = (select auth.uid()) and (select private.has_permission('orders.view_assigned'))));

grant select on public.order_items, public.order_status_history to authenticated;
create policy order_items_admin_read on public.order_items for select to authenticated
  using (private.can_view_order(order_id));
create policy order_status_history_admin_read on public.order_status_history for select to authenticated
  using (private.can_view_order(order_id));

grant select, insert on public.order_notes to authenticated;
create policy order_notes_read on public.order_notes for select to authenticated
  using (private.can_view_order(order_id));
create policy order_notes_insert on public.order_notes for insert to authenticated
  with check (author_id = (select auth.uid())
              and private.can_view_order(order_id)
              and ((select private.has_permission('orders.manage'))
                   or (select private.has_permission('orders.update_fulfillment'))));

grant select on public.payment_submissions to authenticated;
create policy payment_submissions_admin_read on public.payment_submissions for select to authenticated
  using ((select private.has_permission('payments.view')));

grant select on public.inventory_movements to authenticated;
create policy inventory_movements_admin_read on public.inventory_movements for select to authenticated
  using ((select private.has_permission('inventory.manage')) or (select private.has_permission('reports.operational')));

grant select on public.printing_jobs, public.printing_files, public.printing_job_history to authenticated;
create policy printing_jobs_admin_read on public.printing_jobs for select to authenticated
  using ((select private.has_permission('printing.view')));
create policy printing_files_admin_read on public.printing_files for select to authenticated
  using ((select private.has_permission('printing.view')));
create policy printing_job_history_admin_read on public.printing_job_history for select to authenticated
  using ((select private.has_permission('printing.view')));

grant select on public.audit_logs to authenticated;
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using ((select private.has_permission('audit.view')));

-- notifications_outbox, rate_limits: RLS on, no policies, no grants => service_role only.
