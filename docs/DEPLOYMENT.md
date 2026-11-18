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

Option A — local Supabase (Docker):

```bash
npx supabase start
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
2. **Auth → Providers → Email**: keep email/password enabled. **Auth → Settings**: disable "Allow new users to sign up" (customers never sign up; staff are invited). Set minimum password length ≥ 12.
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
4. Storage buckets and their policies are created by migration `20261118000009_storage.sql`. Verify in **Storage** that `payment-receipts` and `printing-files` are **private** and `product-images`, `site-assets` are public.
5. **Project Settings → API Keys**: copy the publishable key (`sb_publishable_…`) and a secret key (`sb_secret_…`).
6. Generate TypeScript types (from Phase 2 on):

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_REF > src/lib/supabase/database.types.ts
```

## 3. First Super Admin (secure bootstrap)

No admin passwords exist in code. Until the guided script ships in Phase 4:

1. **Auth → Users → Add user** (or "Invite"): enter the owner's email and a strong password; confirm the email.
2. In the **SQL Editor** (runs as a trusted role), run once, replacing the email and name:

```sql
select public.bootstrap_super_admin(
  (select id from auth.users where email = 'owner@yourshop.com'),
  'Owner Full Name'
);
```

The function refuses to run again once an active Super Admin exists. All further staff are created from `/admin/staff` _(Phase 4)_.

## 4. Telegram bot _(Phase 6)_

1. In Telegram, open **@BotFather** → `/newbot` → save the token as `TELEGRAM_BOT_TOKEN`.
2. Create a private group for order alerts, add the bot, send any message in the group.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (negative number for groups) → `TELEGRAM_ADMIN_CHAT_ID`.
4. In BotFather, `/setjoingroups` → Disable, so nobody can add the bot elsewhere.

## 5. Vercel _(full checklist in Phase 7)_

1. Import the GitHub repository in Vercel (framework: Next.js).
2. Set every variable from `.env.example` for **Production** (and Preview with a separate Supabase project). Mark secrets as Sensitive.
3. Set `APP_URL=https://yourshop.com`.
4. **Domains**: add `yourshop.com` and `www.yourshop.com`, follow the DNS instructions (A/CNAME at your registrar), redirect `www` → apex.
5. In Supabase **Auth → URL Configuration**: Site URL `https://yourshop.com`, redirect URL `https://yourshop.com/admin/**`.
6. Cron jobs (`vercel.json`) are added in Phases 3, 5 and 6.
