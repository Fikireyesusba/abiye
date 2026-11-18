-- =============================================================================
-- 0009 STORAGE BUCKETS & POLICIES
--   product-images   PUBLIC   catalog images (admin upload)
--   site-assets      PUBLIC   logo, banners (admin upload)
--   payment-receipts PRIVATE  customer receipts (server upload; admin signed URLs)
--   printing-files   PRIVATE  customer documents (server upload; admin signed URLs)
-- Customer uploads never go directly from the browser to Storage: the Next.js
-- server validates type/size/magic bytes, then uploads with the service role.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images',   'product-images',   true,  5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('site-assets',      'site-assets',      true,  5242880,  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('payment-receipts', 'payment-receipts', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf']),
  ('printing-files',   'printing-files',   false, 26214400, array[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/msword', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets serve reads through the public CDN URL; listing/writes need policies.
create policy "product images: admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.has_permission('products.manage')));
create policy "product images: admin update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select private.has_permission('products.manage')));
create policy "product images: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select private.has_permission('products.manage')));

create policy "site assets: admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-assets' and ((select private.has_permission('settings.manage'))
                                            or (select private.has_permission('promotions.manage'))));
create policy "site assets: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-assets' and ((select private.has_permission('settings.manage'))
                                       or (select private.has_permission('promotions.manage'))));

-- Private: read (=> signed URL creation) only for permitted staff. No anon access at all.
create policy "receipts: payment reviewers read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts' and (select private.has_permission('payments.view')));

create policy "printing files: printing staff read" on storage.objects for select to authenticated
  using (bucket_id = 'printing-files' and (select private.has_permission('printing.view')));
create policy "printing files: printing managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'printing-files' and (select private.has_permission('printing.manage')));
