# Project Progress

Living tracker so work can continue across sessions. **Update this file at the end of every work session.**

- Architecture & plan: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Setup & deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Current status

| Phase | Status |
|---|---|
| 1 — Planning & foundation | ✅ Complete (2026-11-18) |
| 2 — Customer storefront | ⏭ Next |
| 3 — Checkout & bank transfer | ⬜ Not started (DB functions already done + tested) |
| 4 — Admin dashboard | ⬜ Not started (auth guards + RBAC SQL done + tested) |
| 5 — Printing services | ⬜ Not started (DB functions done + tested) |
| 6 — Telegram integration | ⬜ Not started (outbox done + tested) |
| 7 — Finalization & deployment | ⬜ Not started |

## Phase 1 — what exists and is verified

**Database** (`supabase/migrations/`, 9 migrations) — verified by `npm run test:db` (142 assertions, real PostgreSQL 16 with Supabase emulation):
- Full schema: RBAC, catalog, inventory history, customers, orders, payments, printing, settings, banks, delivery zones, promotions, banners, outbox, audit log, rate limits.
- RLS on every table, explicit grants only, column-level grants on products.
- Transactional functions: `create_order`, `submit_payment`, `create_printing_job`, `expire_unpaid_orders`, `claim_notifications`/`complete_notification`, `check_rate_limit`, all `admin_*` functions, `bootstrap_super_admin`.
- Storage buckets + policies (product-images, site-assets public; payment-receipts, printing-files private).
- Sample seed (`supabase/seed.sql`), clearly marked `[SAMPLE]`, fake bank details.

**App foundation** — verified by `npm test` (65 tests), lint, typecheck, `npm run build`, and a browser render check:
- `src/lib/env.ts` (lazy Zod-validated server env), Supabase clients (`server`, `admin`, `browser`), `src/proxy.ts` (session refresh, fail-closed `/admin` gate).
- `src/lib/auth/` permission constants, `getAdminContext` / `requireAdmin` / `requirePermission` (untested against live Supabase yet — Phase 4).
- Domain libs: phone normalization, santim money math, cart + printing price mirrors, tokens/tracking codes, upload magic-byte validation, checkout/payment/settings Zod schemas, DB error-code mapping.
- i18n (next-intl, cookie/Accept-Language, en + am catalogs), design tokens, Inter + Noto Sans Ethiopic, shadcn/ui base components, `StatusBadge`.
- Security headers (HSTS, frame deny, nosniff, referrer, permissions policy).

## Decisions made (change if you disagree)

1. Customers are guests (no accounts). Staff are the only Supabase Auth users; public sign-ups disabled.
2. Stock is **reserved at order creation** and released on cancel/expiry (default payment window 24 h, editable in settings).
3. Managers may verify payments (see permission matrix note in ARCHITECTURE.md §3).
4. Order tracking = private link token, or order number + 10-char tracking code (rate-limited).
5. Uploads over Vercel's 4.5 MB body limit use Supabase signed upload URLs + server-side verification.
6. Printing price = pages × copies × per-page rule (color/size/sides) + flat service charge.
7. Carts are client-side; the server recomputes everything.

## Needed from the business owner before production

- [ ] Business name, logo, brand colors (if different from emerald/gold)
- [ ] Real bank account(s): bank, holder, number, branch, instructions (EN + AM)
- [ ] Delivery cities/zones and fees; free-delivery threshold (if any); payment window
- [ ] Printing prices per color/size/sides; service charge; file retention days
- [ ] Contact phone, email, address, opening hours, social links
- [ ] Domain name; Supabase project; Vercel account; Telegram bot + admin chat
- [ ] Native-speaker review of Amharic translations (`messages/am.json`, seed names)
- [ ] Privacy policy & terms content (or approval of drafts in Phase 7)

## Known limitations / follow-ups

- shadcn CLI registry is blocked in the Claude cloud sandbox; components are authored manually in shadcn format. On a normal machine `npx shadcn@latest add <component>` works.
- `npm install` hit an npm arborist bug resolving vitest peers; `vitest`/`vite` were added with `--legacy-peer-deps`. `npm ci` from the lockfile works normally.
- Supabase TypeScript types not generated yet (needs a live project): run `npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts` in Phase 2.
- Content-Security-Policy deferred to Phase 7.
- `/admin/login` must validate the `next` redirect parameter (same-origin `/admin/...` only) — Phase 4.

## Next session: start Phase 2

1. Read `AGENTS.md` (Next.js 16 rules), this file, and `docs/ARCHITECTURE.md`.
2. Create/link a Supabase project (or `npx supabase start` locally), apply migrations, generate types.
3. Build storefront layout, homepage, catalog, product page, cart.
4. Run `npm run check` and `npm run test:db`; update this file.
