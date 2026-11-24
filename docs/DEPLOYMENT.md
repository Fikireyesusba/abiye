# Setup & Deployment

> This guide grows with each phase. Sections marked _(Phase N)_ are not usable yet.

## 1. Local development

Requirements: Node.js 20.9+ (22 recommended), npm, optionally Docker (for a local Supabase stack) and PostgreSQL 16 client/server binaries (for `npm run test:db`).

```bash
npm ci
```

```bash
cp .env.example .env.local
```

Option A — local Supabase (Docker). Starts Docker if needed, then Supabase, then checks the API:

```bash
npm run dev:up
```

`supabase start` applies `supabase/migrations/*` and `supabase/seed.sql` and prints the local URL and keys; copy them into `.env.local`. Then add labelled sample product images (local projects only):

```bash
npm run dev:sample-images
```

After changing migrations, regenerate types:

```bash
npm run db:types
```

Option B — a hosted Supabase dev project: see §2, then put its URL/keys in `.env.local`.

```bash
npm run dev
```

Quality gates:

```bash
npm run check
```

```bash
npm run test:db
```

## 2. Supabase project (browser only — no terminal needed)

The owner works only in the GitHub, Vercel, Resend and Supabase websites. Nothing is run from a personal computer.

1. Create a project at supabase.com (region closest to Ethiopia, e.g. EU Central / Frankfurt). Save the database password in your password manager.
2. **Create the database** — once:
   - On GitHub open `supabase/production-setup.sql` and click **Copy raw file** (the copy icon above the file).
   - Supabase → **SQL Editor → New query** → paste → **Run**.
   - The result shows `cosmetics 6, electronics 7, printing 1`. It is one transaction: if anything fails, nothing is changed, and it refuses to run twice.
   - It contains all migrations, the security rules, storage buckets, default settings (business name "Abiye") and the category structure — **no sample products, no fake bank details**.
3. Check **Storage**: `payment-receipts` and `printing-files` are private; `product-images` and `site-assets` are public.
4. **Authentication → Sign In / Providers → Email**: email enabled, **Confirm email = ON**, **Allow new users to sign up = ON**. Password: minimum 8, letters and digits.
5. **Project Settings → API Keys**: you will copy the publishable key (`sb_publishable_…`) and a secret key (`sb_secret_…`) into Vercel (§5). Never anywhere else.

**Later database changes.** Each new file in `supabase/migrations/` must be applied the same way: open it on GitHub → Copy raw file → SQL Editor → Run (in filename order). The developer tells you which file(s) after each change. (Alternatively, Supabase's GitHub integration can apply migrations automatically on merge — check whether your plan includes it.)

## 2b. Customer accounts: emails (required before launch)

Customers must confirm their email before they can order, and "forgot password" works by email. Supabase's built-in sender only delivers to your own team's addresses (a few per hour), so production needs an email-sending service:

1. Pick a sender (all have free tiers): **Brevo** (300 emails/day), **Resend** (100/day), or **Gmail** with an *App Password* (Google account → Security → 2-Step Verification → App passwords; host `smtp.gmail.com`, port `465`).
2. Supabase → **Authentication → Emails → SMTP Settings**: enable custom SMTP, enter host, port, username, password (stored by Supabase, never in this repo), sender name "Abiye", sender email (e.g. `no-reply@yourshop.com` or your Gmail address).
3. **Authentication → URL Configuration**: Site URL `https://yourshop.com`; Redirect URLs `https://yourshop.com/**`.
4. **Authentication → Emails → Templates**:
   - *Confirm signup*: subject “Confirm your Abiye account”, body = contents of `supabase/templates/confirm.html`.
   - *Reset password*: subject “Reset your Abiye password”, body = contents of `supabase/templates/recovery.html`.
   - *Invite user*: subject “You've been invited to Abiye”, body = contents of `supabase/templates/invite.html` (used when you invite someone from Supabase → Authentication → Users; they choose a password and get a normal customer account — never admin access).

   These links (`/auth/confirm?token_hash=…`) work even when the customer opens the email on a different phone or computer.
5. Test: create an account on the live site with your own email, confirm it, place a small test order, then use "Forgot password".

### Resend (recommended) — exact settings

1. Create an account at resend.com.
2. **Domains → Add domain**: use your shop domain (e.g. `yourshop.com`). Resend shows a few DNS records (SPF/MX on a `send` subdomain and a DKIM `resend._domainkey` TXT record). Add them at your domain registrar or DNS provider (e.g. Cloudflare, Namecheap), then click **Verify**. It usually takes minutes, sometimes a few hours.
3. **API Keys → Create API key**: permission *Sending access*, restricted to your domain. Copy it once. Do not commit it or paste it in chat.
4. Supabase → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@yourshop.com` (must be on the verified domain) |
   | Sender name | `Abiye` |
   | Host | `smtp.resend.com` |
   | Port | `465` (or `587`) |
   | Username | `resend` |
   | Password | the Resend API key |

5. Supabase → **Authentication → Rate Limits**: raise "emails sent per hour" (e.g. 100) so sign-up bursts aren't blocked. Resend's free plan allows 100 emails/day and 3,000/month.
6. Finish steps 3–5 above (URL configuration, the two templates, test).

Without a verified domain, Resend only delivers to your own Resend login email. That's fine for a first test, but customers won't receive anything.

## 3. First Super Admin (browser only)

No admin passwords exist in code.

1. Supabase → **Authentication → Users → Add user → Create new user**: your email + a strong password (12+ characters, upper/lower case and a number), tick **Auto Confirm User**.
2. Supabase → **SQL Editor → New query**, replace the email and name, **Run** once:

```sql
select public.bootstrap_super_admin(
  (select id from auth.users where email = 'owner@yourshop.com'),
  'Owner Full Name'
);
```

3. Sign in at `https://yourshop.com/admin/login`. All other staff are created from **/admin/staff** (role + one-time temporary password).

It refuses to run again once an active Super Admin exists. (Developers can instead use `scripts/create-super-admin.mjs` from a terminal.)

## 4. Telegram bot

1. In Telegram, open **@BotFather** → `/newbot` → choose a name → copy the token (looks like `7000000000:AA…`).
2. Create a **private group** for staff alerts (e.g. "Abiye Orders"), add the bot to it, and send any message in the group.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy `"chat":{"id": …}` — group ids are negative (e.g. `-1001234567890`).
4. In BotFather: `/setjoingroups` → **Disable** (nobody can add your bot to other groups) and `/setprivacy` → **Enable**. If the group stops members from sending messages, make the bot an **admin with every right switched off** (admins can always post); otherwise Telegram answers "not enough rights to send text messages".
5. In Vercel → Settings → Environment Variables (Production), add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` (mark the token **Sensitive**), then redeploy.
6. Sign in to `/admin/notifications` and press **Send test message**. You should see the test message in the group.
7. **Second bot for security** (recommended): repeat steps 1–4 for a new bot and a separate private group (e.g. "Abiye Security"), then add `TELEGRAM_SECURITY_BOT_TOKEN` (Sensitive) and `TELEGRAM_SECURITY_CHAT_ID` in Vercel and redeploy. Security events, 🚨 alerts, admin sign-ins and admin actions go there; orders, payments, printing, top-ups, stock and customer-message copies stay in the first group. Test it with the security group's **Send test message**.
8. Optional third and fourth bots, same way: **stock** (`TELEGRAM_STOCK_BOT_TOKEN`, `TELEGRAM_STOCK_CHAT_ID`; low stock / sold out — until set, these go to the orders group) and **receipts** (`TELEGRAM_RECEIPTS_BOT_TOKEN`, `TELEGRAM_RECEIPTS_CHAT_ID`; the receipt file of every verified / rejected payment), and a fifth for **printing** (`TELEGRAM_PRINTING_BOT_TOKEN`, `TELEGRAM_PRINTING_CHAT_ID`; every document of a printing job, as a file, as soon as the customer submits the payment), and a sixth for **support** (`TELEGRAM_SUPPORT_BOT_TOKEN`, `TELEGRAM_SUPPORT_CHAT_ID`; every new Support & feedback ticket and customer reply). Each group has its own test button.

**How delivery works.** Every order event writes a row to `notifications_outbox` in the same database transaction, so an order can never be lost because Telegram is down. The message is sent immediately after the customer's request finishes (Next.js `after()`), with the payment receipt attached as a photo (or PDF). Failed sends retry with backoff (1, 2, 4 … minutes, 8 attempts) whenever the next event happens or the retry job runs; `/admin/notifications` shows failures and has a **Retry** button.

**Retry job frequency.** `vercel.json` runs `/api/cron/notifications` once a day because the Vercel Hobby plan only allows daily cron jobs (a more frequent schedule makes the deployment fail). For faster retries during a Telegram outage either:
- on Vercel **Pro**, change its schedule to `*/15 * * * *`; or
- use a free external scheduler (e.g. cron-job.org) to call `GET https://yourshop.com/api/cron/notifications` every 10–15 minutes with the header `Authorization: Bearer <CRON_SECRET>`.

## 5. Vercel (browser only)

1. Vercel → **Add New → Project → Import** the GitHub repository `Fikireyesusba/abiye` (framework: Next.js, settings auto-detected). Vercel deploys the repository's default branch (`phase-1-foundation` until a `main` branch is introduced) as Production; change it under Project → Settings → Git → Production Branch.
2. Set every variable from `.env.example` for **Production** (and Preview with a separate Supabase project). Mark secrets as Sensitive.
3. Set `APP_URL=https://yourshop.com`.
4. **Domains**: add `yourshop.com` and `www.yourshop.com`, follow the DNS instructions (A/CNAME at your registrar), redirect `www` → apex.
5. In Supabase **Auth → URL Configuration**: Site URL `https://yourshop.com`, redirect URL `https://yourshop.com/admin/**`.
6. Cron: `vercel.json` schedules `/api/cron/expire-orders`, `/api/cron/printing-retention` (storage maintenance: expired printing files + abandoned uploads older than a day) and `/api/cron/notifications` daily (Hobby plan limit). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically once `CRON_SECRET` is set. On the Pro plan, change the schedule to hourly (e.g. `17 * * * *`).

## 6. Database updates after launch (browser only)

`production-setup.sql` is run once. Each later change is a single new file in `supabase/migrations/` — paste it into the Supabase SQL Editor and Run, in filename order, once. Already published after the first setup: `…0017_admin_customer_accounts.sql`, `…0018_customer_account_management.sql`, `…0019_finalization.sql`, `…0020_personal_promotions.sql`, `…0021_admin_mfa.sql`, `…0022_customer_emails.sql`, `…0023_customer_push.sql`, `…0024_export_audit.sql`, `…0025_staff_not_customers.sql`, `…0026_wallet.sql`, `…0027_security_monitoring.sql`, `…0028_profile_and_activity_tools.sql`, `…0029_payment_export.sql`, `…0030_pickup_cleanup_and_receipt_archive.sql`, `…0031_stock_alerts.sql`, `…0032_product_reviews.sql`, `…0033_sales_reports.sql`, `…0034_data_export_reset.sql`, `…0035_security_reviews.sql`, `…0036_telegram_activity_feed.sql`, `…0037_telegram_two_groups.sql`, `…0038_activity_categories.sql`, `…0039_personal_code_messages.sql`, `…0040_customers_without_staff.sql`, `…0041_telegram_four_groups.sql`, `…0042_staff_remove.sql`, `…0043_product_audience.sql`, `…0044_single_session_push_owner.sql`, `…0045_paid_orders_locked_details.sql`, `…0046_warsaw_gmail_printing_cancel.sql`, `…0047_age_sex.sql`, `…0048_manage_services.sql`, `…0049_instore_clear_tools.sql`, `…0050_search_permissions.sql`. PROGRESS.md records which ones production has.

## 6a. Separate addresses: customers, staff, Super Admin, couriers

One website, four addresses — each opens only its own part, and each permission set signs in only at its own address:

| Address | Who | What |
|---|---|---|
| `abiye.site` | customers | shop and customer app (no `/admin`, no courier app — "not found") |
| `ocs.abiye.site` | managers, staff and other permission sets | admin portal only |
| `operations.abiye.site` | Super Admins only | admin portal only |
| `courier.abiye.site` | couriers only | courier app only (installs as "Abiye Courier") |

A sign-in at the wrong address is refused ("This account signs in at a different address") and recorded as a security event. Telegram "Open in admin" links use `ocs` (security and receipts groups: `operations`).

Setup, in this order (browser only):
1. **Vercel → Settings → Domains → Add** `ocs.abiye.site`, `operations.abiye.site` and `courier.abiye.site` (Production). Add the DNS records Vercel shows (usually a CNAME to `cname.vercel-dns.com`) at your domain registrar. Wait until each shows **Valid Configuration**.
2. **Supabase → Authentication → URL Configuration → Redirect URLs**: add `https://ocs.abiye.site/**`, `https://operations.abiye.site/**`, `https://courier.abiye.site/**`.
3. **Vercel → Settings → Environment Variables (Production)**: `CUSTOMER_HOST=abiye.site`, `STAFF_HOST=ocs.abiye.site`, `SUPER_ADMIN_HOST=operations.abiye.site`, `COURIER_HOST=courier.abiye.site`, then **Redeploy** (and Promote if the deployment shows Stale). The split is switched on only when all four are set; until then everything keeps working on every address.
4. Sign in as Super Admin at `https://operations.abiye.site/admin`; tell staff to use `https://ocs.abiye.site` and couriers `https://courier.abiye.site` (each can install it on their phone).

To switch the split off again, delete the four variables and redeploy.

**Change password (staff, admins, couriers):** `https://ocs.abiye.site/admin/password` (Super Admin: `https://operations.abiye.site/admin/password`, couriers: `https://courier.abiye.site/admin/password`; also linked under the sign-in form). Email → current password → 6-digit authenticator code → new password twice → **Save changes** → Done. The account is then signed out on every device. Forgotten passwords: the Super Admin resets them under Staff.

## 6b. Couriers

- Admin → **Staff → Add staff member**, permission set **Courier**. Couriers sign in (password + two-step code, like all staff) at the courier address and see only the deliveries assigned to them.
- On a paid **delivery** order: Admin → order → **Courier** → choose → **Assign courier**. The customer gets a **4-digit delivery code** (order page and the "on its way" email).
- Courier: **Picked up — on my way** (customer told it is on its way) → at the door, enter the customer's code → **Delivered** (order completed). Or **Couldn't deliver** with a reason (order back to preparing; the office decides). 5 wrong codes lock the delivery — re-assign the courier to unlock it.
- The courier sees the customer's name, phone (call button) and address (map link) only while the delivery is assigned and open.
- **Courier app on the phone:** open `https://courier.abiye.site`, sign in, then tap **Install** on the "Install the courier app" card (Android / Chrome), or on iPhone: Safari → Share → **Add to Home Screen**. It appears as **Abiye Courier** and opens straight on the deliveries. (Staff can do the same at `ocs` → "Abiye OCS"; Super Admin at `operations` → "Abiye Operations".) Every step is in the Activity log and the orders & payments Telegram group (with the courier's User ID).

### Courier app and Couriers & delivery (admin)

- **Courier app** (bottom tabs): **Deliveries** (assigned to me; Picked up → Delivered with the customer's PIN / Couldn't deliver; **Decline** before pickup with a reason — the order goes back to Dispatch and the courier is set off duty), **Earnings** (today, month, to be paid, payments), **Notifications** (red badge), **Profile** (phone; vehicle and documents shown, set by the office). **Go on duty** → tick the cities you can deliver to; **Go off duty**. The app **rings** when a delivery is assigned (while open; checks every 20 s) until the courier taps the banner — the Super Admin's ringtone or a built-in ring; phones also vibrate. Going on / off duty is not a Telegram alert.
- **Pay:** for each order delivered with the customer's PIN the courier earns the **full delivery price of that city** (Settings → Delivery cities & fees), even when the customer paid less thanks to the bigger-purchase discount.
- **Admin → Couriers & delivery**: **Online now** (who is on duty, for which cities, vehicle, load); **Dispatch** (paid delivery orders waiting; couriers on duty for the order's city first; courier pay shown); **Couriers**; **Ringtone** (Super Admin: upload MP3 / OGG / WAV / M4A, max 2 MB); **Excel** (Super Admin: orders handled by couriers, by dates and courier). Courier page (Super Admin): vehicle (on foot / bicycle / motorcycle / car — motorcycle and car need make, model, plate, insurance company + policy + expiry and driving licence number + expiry), unpaid deliveries → **Mark as paid**, payments.
- **Delivery discount for bigger purchases** (Super Admin, Settings → Delivery): e.g. from 5,000 ETB 10 % off, from 10,000 ETB 30 % off the delivery fee (a 1,000 ETB delivery becomes 900, then 700). The purchase is products + printing before any promo code; checkout shows it. (Migration 0072 replaced the old item-count steps — set them again.)
- **Cities:** about 85 Ethiopian cities are listed (switched off) under Settings → Delivery → "Other Ethiopian cities": set the fee, tick Available and press Save to open one. "Order" is the position in the city list at checkout (lower numbers first).
- **HR details** (Staff → a person → HR details; staff.manage): job title, start date, Fayda number, passport (optional), address, city, emergency contact, notes. Never copied into the Activity log or Telegram.

## 6b-1. Partner shops — Abiye Business app (migration 0073)

Customers in other cities can collect their order at a **partner shop**. The courier brings it there; the courier and the shop check **each other's PIN**; the customer collects it with **their own PIN**; the shop earns a **handling fee** per collected order.

**Set up (once):**
1. **Address for the app (recommended):** Vercel → Settings → Domains → add `business.abiye.site` (+ the DNS record Vercel shows); Supabase → Authentication → URL Configuration → Redirect URLs: add `https://business.abiye.site/**`; Vercel → Environment Variables (Production): `BUSINESS_HOST=business.abiye.site` → Redeploy. Until `BUSINESS_HOST` is set, shop staff sign in at the courier address (`courier.abiye.site`).
2. **The shop's city** must be switched on with its delivery price (Settings → Delivery cities & fees).
3. **Admin → Partner shops → Add shop** (Super Admin): name, city, full address, landmark, phone, opening hours, map link, handling fee per order.
4. **Shop staff:** Staff → Add staff member with the permission set **Partner shop**, then Partner shops → **Shop staff** → choose their shop. They sign in at `https://business.abiye.site` (email, password, authenticator code) and can install it as **Abiye Business**.

**How an order goes:**
- **Checkout:** "Pick up at a partner shop (other cities)" → choose the shop; its full address, landmark, phone, hours and map link are shown. The customer pays the **delivery price of the shop's city** (same bigger-purchase discount). The order keeps a copy of the shop's details.
- **Dispatch** (Couriers & delivery): the order shows "to partner shop …"; assign a courier as usual. Two 4-digit hand-over PINs are made.
- **Courier app:** Picked up → at the shop, the courier tells the shop **their PIN** and types the **shop's PIN**. **Business app:** the shop sees the order under "Courier on the way" with **its PIN**, and types the **courier's PIN** → Received. When both PINs are checked the order is **at the shop** (ready for pickup); the courier earns the city price; the customer gets an email with the shop address and their **pickup PIN** (also on their order page).
- **Customer at the shop:** the shop types the customer's PIN → **Handed over** → order completed; the shop earns its handling fee.
- 5 wrong hand-over PINs lock the hand-over (re-assign the same courier on the order to unlock); 5 wrong customer PINs lock the pickup (call the office).
- **Admin → Partner shops** (Super Admin): shops (on the way / at the shop / collected / to pay), **Shop staff**, **Add shop**, **Excel** (orders collected at partner shops). Shop page: details, open orders, unpaid → **Mark as paid**, payments. The shop sees its earnings and payments in the app. Every step is in the Activity log and the orders & payments Telegram group.

### Delivery monitor and alerts (migration 0074)

- **Privacy:** couriers and partner shops see the **order number and the customer's name** only (plus the address / phone they need while the order is theirs) — no products, quantities or prices.
- **Admin → Delivery monitor** (Couriers & delivery / Orders / Partner shops permissions): counts (waiting for a courier, to pick up, on the way, at partner shops, couriers online, delivered today, wrong PINs today, locked orders); **Now** (late orders); **Couriers & shop staff** (on duty, last activity, last sign-in, wrong PINs today); **App log** (every courier and Business app event: assigned, picked up, delivered, failed, declined, hand-over PINs, collected, on / off duty, **every wrong PIN**), filter Courier app / Business app; **Alert settings** (Super Admin).
- **Telegram alerts:** late orders → orders & payments group, once per order and step: paid but no courier after 2 h, assigned but not picked up after 2 h, on the way more than 6 h, waiting at a partner shop more than 3 days. Wrong PINs → security group at the 3rd wrong PIN on an order (5 locks it). All limits are set in Alert settings.
- The check runs at most every 5 minutes while the admin, courier or Business app is open, and once a day by the daily job.

## 6b-2. New customer accounts need approval

New sign-ups are **Under verification**: they can sign in, browse and use Support & feedback, but cannot order, top up, use printing or write reviews until approved. The security Telegram group announces each new account. **Admin → Account approvals** (permission "Approve or reject new customer accounts" — Super Admin; add it to other permission sets under Staff if needed): see the details, **Approve** (customer emailed, can order) or **Reject, delete & block** with a reason (customer emailed "due to security reasons…", account deleted, email on the block list with the reason). Customers invited from Admin → Customers are approved at once; existing customers stay approved.

## 6c. Virus scan of customer uploads (Cloudmersive)

Every file a customer uploads — payment receipts, wallet top-up receipts and printing documents — is checked by content (real file type) and then sent to Cloudmersive's **advanced virus scan** before it is accepted. It must be clean: no virus / malware, no programs, scripts, macros, embedded HTML or XML external entities, not broken or disguised, **not password-protected**, and of the expected format (`.pdf`, `.jpg`, `.png`, `.docx`).

- **Not clean** → the file is deleted at once, the customer is asked for another file (e.g. a screenshot or an unlocked PDF), and a **security event** is recorded (Admin → Security; security Telegram group with the User ID and what was found). The account becomes an active alert.
- **Scanner unavailable** (key missing or wrong, monthly limit used up, outage) → the upload is **refused** ("try again in a few minutes"); nothing unscanned is kept. Admin → Security → Site health shows it, and the security Telegram group is told.

Setup (browser only):
1. Create an account at **cloudmersive.com**, then **account.cloudmersive.com → API Keys → Create** and copy the key.
2. Vercel → Settings → Environment Variables (Production): `CLOUDMERSIVE_API_KEY` = the key (mark **Sensitive**), then **Redeploy**.
3. Admin → Security → Site health should say "Virus scanning of customer uploads active". Upload a test receipt to check.

Plan limits: the free plan has a monthly scan limit and scans files up to **3.5 MB**. The website matches it:
- Large **photos** (JPG / PNG receipts or print images) are made smaller in the customer's browser before upload (a phone camera photo of several MB becomes about 1 MB, still easy to read; print images keep high quality and are only reduced if over the limit).
- **PDF / Word files** larger than the limit are stopped at once with "This file is larger than 3.5 MB … please upload a smaller file" — no scan is used and no false "scanner unavailable" alert. The upload forms show "Largest file: 3.5 MB".
- After upgrading Cloudmersive, set `CLOUDMERSIVE_MAX_MB` in Vercel to the new limit (e.g. `10`) and redeploy. The printing limit is also capped by Admin → Settings → printing max file size and 25 MB.
- When the monthly scan count is used up, uploads are refused ("security check unavailable") until the next month or an upgrade; Site health and the security Telegram group show it.

## 7. Security headers

Every page carries a nonce-based Content-Security-Policy (`src/proxy.ts`, `src/lib/security/csp.ts`): scripts only from this site with the per-request nonce, network/images only to this site and the Supabase project, no framing. If you ever add a third-party script, widget or analytics service, its domain must be added there or the browser will block it. See docs/GO-LIVE.md for the launch checklist.

## 8. Two-step login for admins (authenticator app)

Every admin account (Super Admin, Manager, Staff) signs in with password **and** a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, …). The first sign-in shows a QR code to set it up. Enforced in the app and in the database (migration 0021: admin permissions need an `aal2` session). Customers are not affected.

- Supabase → Authentication → **Multi-Factor**: "Authenticator app (TOTP)" must be enabled (it is by default).
- **Staff lost their phone:** Admin → Staff → "Two-step login" → **Reset**. They set it up again at the next sign-in.
- **You (the only Super Admin) lost your phone:** Supabase → SQL Editor, run (with your admin email):

  ```sql
  delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'you@example.com');
  ```

  Then sign in and set up the authenticator again. Tip: add a second Super Admin (a trusted person) so one can reset the other.

## 9. Customer email notifications (Resend)

Customers get an email (English + Amharic) when: the order is placed (amount, bank details, deadline, link to upload the receipt), the payment is verified, the payment is rejected (with the reason), the order is ready for pickup / out for delivery / completed / cancelled / expired, and a printing price is ready or the printing is ready.

1. Resend → **API Keys** → Create API key: permission **Sending access**, domain `abiye.site`. Copy it (shown once) — do not paste it anywhere else.
2. Vercel → Project → Settings → **Environment Variables** (Production):
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = `Abiye <orders@abiye.site>` (any address at your verified domain)
3. Redeploy (Deployments → … → Redeploy) so the variables take effect.
4. Database: run `supabase/migrations/20261120000022_customer_emails.sql` in the SQL Editor.

Emails use the same reliable queue as the Telegram alerts: they are queued in the same database transaction as the change, sent right after, retried with backoff if Resend is down, and visible in Admin → Notifications (event types starting with `customer_`). Emails that could not be sent within 2 days are dropped instead of arriving late. Without the two variables nothing is sent (the shop works normally).

## 10. Customer phone notifications (Web Push)

Customers who turn them on (My account, or their order page) get a phone notification for the same events as the emails, in the language of their device setting at sign-up of the device (EN/AM). Android: Chrome, installed or not. iPhone: only inside the installed app (iOS 16.4+; the site guides them).

1. Admin → **Notifications** → "Customer phone notifications" → **Create notification keys**. The keys are created in your browser; nothing is sent anywhere.
2. Copy the three values into Vercel → Settings → **Environment Variables** (Production): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` + your email).
3. **Redeploy.** The panel then shows "Configured".
4. Database: run `supabase/migrations/20261120000023_customer_push.sql` in the SQL Editor.

Keep the keys: if you replace them later, every customer must turn notifications on again. Never paste the private key into chats or emails.
