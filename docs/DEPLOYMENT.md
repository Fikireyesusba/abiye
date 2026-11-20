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
   - *Confirm signup*: subject “Confirm your Abiye account / መለያዎን ያረጋግጡ”, body = contents of `supabase/templates/confirm.html`.
   - *Reset password*: subject “Reset your Abiye password / የይለፍ ቃልዎን ይቀይሩ”, body = contents of `supabase/templates/recovery.html`.
   - *Invite user*: subject “You've been invited to Abiye / ወደ አብዬ ተጋብዘዋል”, body = contents of `supabase/templates/invite.html` (used when you invite someone from Supabase → Authentication → Users; they choose a password and get a normal customer account — never admin access).

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
4. In BotFather: `/setjoingroups` → **Disable** (nobody can add your bot to other groups) and `/setprivacy` → **Enable**.
5. In Vercel → Settings → Environment Variables (Production), add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` (mark the token **Sensitive**), then redeploy.
6. Sign in to `/admin/notifications` and press **Send test message**. You should see “Telegram notifications are working” in the group.

**How delivery works.** Every order event writes a row to `notifications_outbox` in the same database transaction, so an order can never be lost because Telegram is down. The message is sent immediately after the customer's request finishes (Next.js `after()`), with the payment receipt attached as a photo (or PDF). Failed sends retry with backoff (1, 2, 4 … minutes, 8 attempts) whenever the next event happens or the retry job runs; `/admin/notifications` shows failures and has a **Retry** button.

**Retry job frequency.** `vercel.json` runs `/api/cron/notifications` once a day because the Vercel Hobby plan only allows daily cron jobs (a more frequent schedule makes the deployment fail). For faster retries during a Telegram outage either:
- on Vercel **Pro**, change its schedule to `*/15 * * * *`; or
- use a free external scheduler (e.g. cron-job.org) to call `GET https://yourshop.com/api/cron/notifications` every 10–15 minutes with the header `Authorization: Bearer <CRON_SECRET>`.

## 5. Vercel (browser only)

1. Vercel → **Add New → Project → Import** the GitHub repository `Fikireyesusba/abi` (framework: Next.js, settings auto-detected). Vercel deploys the repository's default branch (`phase-1-foundation` until a `main` branch is introduced) as Production; change it under Project → Settings → Git → Production Branch.
2. Set every variable from `.env.example` for **Production** (and Preview with a separate Supabase project). Mark secrets as Sensitive.
3. Set `APP_URL=https://yourshop.com`.
4. **Domains**: add `yourshop.com` and `www.yourshop.com`, follow the DNS instructions (A/CNAME at your registrar), redirect `www` → apex.
5. In Supabase **Auth → URL Configuration**: Site URL `https://yourshop.com`, redirect URL `https://yourshop.com/admin/**`.
6. Cron: `vercel.json` schedules `/api/cron/expire-orders`, `/api/cron/printing-retention` (storage maintenance: expired printing files + abandoned uploads older than a day) and `/api/cron/notifications` daily (Hobby plan limit). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically once `CRON_SECRET` is set. On the Pro plan, change the schedule to hourly (e.g. `17 * * * *`).

## 6. Database updates after launch (browser only)

`production-setup.sql` is run once. Each later change is a single new file in `supabase/migrations/` — paste it into the Supabase SQL Editor and Run, in filename order, once. Already published after the first setup: `…0017_admin_customer_accounts.sql`, `…0018_customer_account_management.sql`, `…0019_finalization.sql`, `…0020_personal_promotions.sql`, `…0021_admin_mfa.sql`, `…0022_customer_emails.sql`, `…0023_customer_push.sql`, `…0024_export_audit.sql`, `…0025_staff_not_customers.sql`, `…0026_wallet.sql`, `…0027_security_monitoring.sql`, `…0028_profile_and_activity_tools.sql`, `…0029_payment_export.sql`. PROGRESS.md records which ones production has.

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

1. Resend → **API Keys** → Create API key: permission **Sending access**, domain `fantaf.xyz`. Copy it (shown once) — do not paste it anywhere else.
2. Vercel → Project → Settings → **Environment Variables** (Production):
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = `Abiye <orders@fantaf.xyz>` (any address at your verified domain)
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
