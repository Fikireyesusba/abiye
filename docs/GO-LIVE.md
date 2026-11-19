# Go-live checklist (owner)

Everything here is done in the web dashboards: **Supabase**, **Vercel**, **Resend**, **GitHub**, and the website's own **Admin** (`https://fantaf.xyz/admin`). Tick each item before announcing the shop.

## 1. Database up to date (Supabase → SQL Editor)

Paste each file's full contents (GitHub → file → **Raw** → copy) into a new query and click **Run**, in this order, skipping any you already ran:

1. `supabase/migrations/20261120000018_customer_account_management.sql`
2. `supabase/migrations/20261120000019_finalization.sql`
3. `supabase/migrations/20261120000020_personal_promotions.sql`
4. `supabase/migrations/20261120000021_admin_mfa.sql`
5. `supabase/migrations/20261120000022_customer_emails.sql`

Each should say "Success. No rows returned". If Supabase warns about RLS, choose "Run without RLS" (the files enable it themselves).

## 2. Accounts and email

- [ ] Supabase → Authentication → **URL Configuration**: Site URL `https://fantaf.xyz`.
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
- [ ] **Telegram** (Admin → Notifications): bot token + chat set in Vercel, "Send test message" arrives (docs/DEPLOYMENT.md §4).

## 4. Catalog

- [ ] Categories reviewed (Admin → Categories).
- [ ] Products added with photos, prices, stock and **Active** status. No `[SAMPLE]` products in production (sample data is never loaded there unless you ran `seed.sql`).
- [ ] Optional: a homepage banner and a promotion (Admin → Promotions). Test the promo code at checkout yourself.

## 5. One real end-to-end test

- [ ] As a customer (phone): add to basket → checkout → pay a small real amount by bank transfer → upload the receipt.
- [ ] As admin: Telegram message arrives → Payments → open receipt → **check your bank app** → Verify → move the order to Completed.
- [ ] Printing: upload a PDF, pay, mark ready.
- [ ] Afterwards cancel/refund the test order as you normally would.

## 6. Vercel

- [ ] Project → Settings → **Environment Variables** complete for Production (docs/DEPLOYMENT.md §5), `APP_URL=https://fantaf.xyz`, a long random `CRON_SECRET`.
- [ ] Project → **Cron Jobs**: three daily jobs listed (expire unpaid orders, storage maintenance, notification retries).
- [ ] Domains: `fantaf.xyz` (and `www`) show a valid certificate.
- [ ] Latest deployment is **Ready** and is the one from the newest GitHub commit.

## 7. Daily routine after launch

- **Payments to verify** badge in the admin header: verify only after the money is visible in your bank account. A receipt image alone is not proof.
- **Stalled checkouts**: call or WhatsApp customers who left unpaid orders or full baskets.
- **Activity log** (Super Admin): who changed what — check it if something looks wrong.
- **Analytics**: weekly look at sales, best sellers and low stock.

## Security notes

- Only Super Admins can see bank-account settings, staff, the activity log and revenue.
- Never paste API keys or passwords into chats, GitHub or emails. Keys live only in Vercel / Supabase / Resend settings.
- If a staff member leaves: Admin → Staff → remove access (takes effect immediately).
- If a customer abuses the shop: Admin → Customers → Deactivate (blocks sign-in and ordering).
