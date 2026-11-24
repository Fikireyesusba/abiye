# Go-live checklist (owner)

Everything here is done in the web dashboards: **Supabase**, **Vercel**, **Resend**, **GitHub**, and the website's own **Admin** (`https://operations.abiye.site/admin` for the Super Admin). Tick each item before announcing the shop.

## 1. Database up to date (Supabase → SQL Editor)

Paste each file's full contents (GitHub → file → **Raw** → copy) into a new query and click **Run**, in this order, skipping any you already ran:

1. `supabase/migrations/20261120000018_customer_account_management.sql`
2. `supabase/migrations/20261120000019_finalization.sql`
3. `supabase/migrations/20261120000020_personal_promotions.sql`
4. `supabase/migrations/20261120000021_admin_mfa.sql`
5. `supabase/migrations/20261120000022_customer_emails.sql`
6. `supabase/migrations/20261120000023_customer_push.sql`
7. `supabase/migrations/20261120000024_export_audit.sql`
8. `supabase/migrations/20261120000025_staff_not_customers.sql`
9. `supabase/migrations/20261120000026_wallet.sql`
10. `supabase/migrations/20261120000027_security_monitoring.sql`
11. `supabase/migrations/20261120000028_profile_and_activity_tools.sql`
12. `supabase/migrations/20261120000029_payment_export.sql`
13. `supabase/migrations/20261120000030_pickup_cleanup_and_receipt_archive.sql`
14. `supabase/migrations/20261120000031_stock_alerts.sql`
15. `supabase/migrations/20261120000032_product_reviews.sql`
16. `supabase/migrations/20261120000033_sales_reports.sql`
17. `supabase/migrations/20261120000034_data_export_reset.sql`
18. `supabase/migrations/20261120000035_security_reviews.sql`
19. `supabase/migrations/20261120000036_telegram_activity_feed.sql`
20. `supabase/migrations/20261120000037_telegram_two_groups.sql`
21. `supabase/migrations/20261120000038_activity_categories.sql`
22. `supabase/migrations/20261120000039_personal_code_messages.sql`
23. `supabase/migrations/20261120000040_customers_without_staff.sql`
24. `supabase/migrations/20261120000041_telegram_four_groups.sql`
25. `supabase/migrations/20261120000042_staff_remove.sql`
26. `supabase/migrations/20261120000043_product_audience.sql`
27. `supabase/migrations/20261120000044_single_session_push_owner.sql`
28. `supabase/migrations/20261120000045_paid_orders_locked_details.sql`
29. `supabase/migrations/20261120000046_warsaw_gmail_printing_cancel.sql`
30. `supabase/migrations/20261120000047_age_sex.sql`
31. `supabase/migrations/20261120000048_manage_services.sql`
32. `supabase/migrations/20261120000049_instore_clear_tools.sql`
33. `supabase/migrations/20261120000050_search_permissions.sql`

Each should say "Success. No rows returned". If Supabase warns about RLS, choose "Run without RLS" (the files enable it themselves).

## 2. Accounts and email

- [ ] Supabase → Authentication → **URL Configuration**: Site URL `https://abiye.site`.
- [ ] Supabase → Authentication → **SMTP**: Resend settings saved (docs/DEPLOYMENT.md §2b); the 3 bilingual email templates pasted.
- [ ] Test: sign up a customer with a real email, confirm, sign in, use "Forgot password".
- [ ] Super Admin can sign in at `/admin` with password + authenticator code (two-step login, docs/DEPLOYMENT.md §8). Create staff under **Staff** (each person their own account; never share passwords).

## 3. Business settings (Admin → Settings)

- [ ] **Business**: name, tagline, logo, homepage image.
- [ ] **Bank accounts**: your real account(s) — double-check the account number. Remove/disable any sample account.
- [ ] **Delivery**: cities and fees, free-delivery threshold, payment window (hours), pickup on/off, shop address.
- [ ] **Contact & social**: phone, email, WhatsApp, Telegram, Instagram, TikTok, Facebook, map link, opening hours.
- [ ] **Printing**: prices per page (B/W / colour, A4 / A3, single / double), service charge, max file size, file retention days.
- [ ] **Terms & privacy**: read both (English and Amharic), edit to match how you really work, then tick **Approved** (removes the "draft" notice).
- [ ] **Customer emails**: `RESEND_API_KEY` and `EMAIL_FROM` set in Vercel (docs/DEPLOYMENT.md §9); place a test order and check the email arrives.
- [ ] **Phone notifications**: keys created in Admin → Notifications and added to Vercel (docs/DEPLOYMENT.md §10); turn them on in My account on your phone and place a test order.
- [ ] **Receipt archive** (Admin → Notifications → Payment receipt archive): a separate mailbox you control (e.g. a new Gmail only for receipts), **Send test email** arrives, then **Send past receipts** once.
- [ ] **Telegram** (Admin → Notifications): bot token + chat set in Vercel, "Send test message" arrives (docs/DEPLOYMENT.md §4). Choose what the **activity feed** sends (security events, admin actions, copies of customer notifications).

## 4. Catalog

- [ ] Categories reviewed (Admin → Categories).
- [ ] Products added with photos, prices, stock and **Active** status. No `[SAMPLE]` products in production (sample data is never loaded there unless you ran `seed.sql`).
- [ ] Optional: a homepage banner and a promotion (Admin → Promotions). Test the promo code at checkout yourself.

## 5. One real end-to-end test

- [ ] As a customer (phone): add to basket → checkout → pay a small real amount by bank transfer → upload the receipt.
- [ ] As admin: Telegram message arrives → Payments → open receipt → **check your bank app** → Verify → move the order to Completed.
- [ ] Printing: upload a PDF, pay, mark ready.
- [ ] Afterwards cancel/refund the test order as you normally would.
- [ ] **Clear test data** (Admin → Export & reset): *Export everything* (keep the file), then *Reset test data* (type the phrase + authenticator code). Orders start again at ET-10001. Do this once, just before announcing the shop.

## 6. Vercel

- [ ] Project → Settings → **Environment Variables** complete for Production (docs/DEPLOYMENT.md §5), `APP_URL=https://abiye.site`, a long random `CRON_SECRET`.
- [ ] Project → **Cron Jobs**: three daily jobs listed (expire unpaid orders, storage maintenance, notification retries).
- [ ] Domains: `abiye.site` (and `www`) show a valid certificate.
- [ ] Latest deployment is **Ready** and is the one from the newest GitHub commit.

## 7. Daily routine after launch

- **Payments to verify** badge in the admin header: verify only after the money is visible in your bank account. A receipt image alone is not proof.
- **Stalled checkouts**: call or WhatsApp customers who left unpaid orders or full baskets.
- **Activity log** (Super Admin): who changed what — check it if something looks wrong. Monthly: **Export to Excel** and keep the file; optionally **Clear old entries** afterwards (the last 30 days are always kept).
- **Security** (Super Admin): the red badge = active alerts; open **Active alerts** and Block or Mark as reviewed each one until the dashboard is empty. Glance at it daily — red badge = high-risk sign-in attempts; block emails that keep trying, or **Mark as reviewed** the ones you checked (clears the badge until something new happens); Site health shows anything not working (notifications, scheduled jobs, overdue work).
- **Wallet** (Manager / Super Admin): verify top-ups only after the money is in the bank, like payments.
- **Monthly**: Payments → **Export verified & rejected payments to Excel** and compare the verified totals with your bank statement.
- **Sales reports** (Super Admin): print or export the **Daily closing** and compare *Money into your bank* with your bank app; monthly statement for your accountant.
- **Reviews**: publish or reject waiting reviews (red badge).
- **Inventory**: red badge = products at their low-stock level; restocking automatically emails customers who asked.
- **GitHub**: Dependabot opens update requests weekly; merge one only when its CI check is green (GitHub → Pull requests).
- **Analytics**: weekly look at sales, best sellers and low stock.

## Security notes

- Only Super Admins can see bank-account settings, staff, the activity log and revenue.
- Never paste API keys or passwords into chats, GitHub or emails. Keys live only in Vercel / Supabase / Resend settings.
- If a staff member leaves: Admin → Staff → remove access (takes effect immediately).
- If a customer abuses the shop: Admin → Customers → Deactivate (blocks sign-in and ordering).
