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

## 2. Supabase project

1. Create a project at supabase.com (region closest to Ethiopia, e.g. EU Central / Frankfurt).
2. **Authentication → Sign In / Providers → Email**: email enabled, **Confirm email = ON**, **Allow new users to sign up = ON** (customers create accounts to order; this never grants admin access). Password: minimum length 8, "letters and digits" (staff passwords are held to 12+ characters by the app).
3. Apply the schema from your machine:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

   `db push` applies migrations only — it does **not** load `seed.sql` (sample data) into production.
   Then create the department/category structure once: Supabase → **SQL Editor** → paste `supabase/starter.sql` → **Run** (no sample products or bank details; safe to re-run).
4. Storage buckets and their policies are created by migration `20261118000009_storage.sql`. Verify in **Storage** that `payment-receipts` and `printing-files` are **private** and `product-images`, `site-assets` are public.
5. **Project Settings → API Keys**: copy the publishable key (`sb_publishable_…`) and a secret key (`sb_secret_…`).
6. Generate TypeScript types (from Phase 2 on):

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_REF > src/lib/supabase/database.types.ts
```

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

## 3. First Super Admin (secure bootstrap)

No admin passwords exist in code. From your machine, with the production `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in a local env file that is never committed (e.g. `.env.production.local`):

```bash
node --env-file=.env.production.local scripts/create-super-admin.mjs --email owner@yourshop.com --name "Owner Full Name"
```

You are asked for the password (hidden input; minimum 12 characters with upper-case, lower-case and a digit). Then sign in at `/admin/login`. Additional staff are created from **/admin/staff**.

Alternative without Node:

1. **Auth → Users → Add user**: enter the owner's email and a strong password; confirm the email.
2. In the **SQL Editor** (runs as a trusted role), run once, replacing the email and name:

```sql
select public.bootstrap_super_admin(
  (select id from auth.users where email = 'owner@yourshop.com'),
  'Owner Full Name'
);
```

Both routes refuse to run once an active Super Admin exists.

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

## 5. Vercel _(full checklist in Phase 7)_

1. Import the GitHub repository in Vercel (framework: Next.js).
2. Set every variable from `.env.example` for **Production** (and Preview with a separate Supabase project). Mark secrets as Sensitive.
3. Set `APP_URL=https://yourshop.com`.
4. **Domains**: add `yourshop.com` and `www.yourshop.com`, follow the DNS instructions (A/CNAME at your registrar), redirect `www` → apex.
5. In Supabase **Auth → URL Configuration**: Site URL `https://yourshop.com`, redirect URL `https://yourshop.com/admin/**`.
6. Cron: `vercel.json` schedules `/api/cron/expire-orders`, `/api/cron/printing-retention` and `/api/cron/notifications` daily (Hobby plan limit). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically once `CRON_SECRET` is set. On the Pro plan, change the schedule to hourly (e.g. `17 * * * *`).
