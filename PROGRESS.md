# Project Progress

Living tracker so work can continue across sessions. **Update this file at the end of every work session.**

- Architecture & plan: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Setup & deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Current status

| Phase | Status |
|---|---|
| 1 — Planning & foundation | ✅ Complete (2026-11-18) |
| 2 — Customer storefront | ✅ Complete (2026-11-18) |
| 3 — Checkout & bank transfer | ✅ Complete (2026-11-19) |
| 4 — Admin dashboard | ⏭ Next (auth guards + RBAC SQL done + tested) |
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

## Phase 2 — storefront (verified)

Verified against a **real local Supabase stack** (`npx supabase start`, Docker): all migrations apply, all 145 SQL assertions pass there too, and a 40-check browser smoke test passes (`npm run test:smoke`).

- Pages: `/`, `/shop`, `/cosmetics`, `/electronics`, `/products/[slug]`, `/cart`, `/printing` (live price list; online ordering is Phase 5), `/about`, `/contact`, `/privacy`, `/terms` (DRAFT legal text, EN + AM), 404, error boundary, `sitemap.xml`, `robots.txt`.
- Header (logo/name from settings, nav, search, language switch, cart count), mobile slide-out menu, footer from settings.
- Homepage fully driven by DB: hero text/image, banners, featured products, sale products + homepage promotions, why-us, contact.
- Catalog: department + subcategory filters, search in English and Amharic (sanitized against PostgREST filter injection), sort by newest/price/name, in-stock filter, pagination — all URL-based (works without JS).
- Product page: gallery, sale price + savings, stock state, quantity, add to basket, related products, JSON-LD.
- Cart: localStorage (ids + quantities only), live prices/stock re-read from the server, delivery/pickup + city fee, free-delivery threshold, over-stock lines block checkout with a one-tap fix, cross-tab sync.
- Migration `0010`: `effective_price_etb` generated column (sortable by anon) replacing the computed-field function; **fixed `product_images.storage_path` check** (PostgreSQL regex max repetition is 255, the old check failed every insert).
- Dev tooling: `npm run db:types`, `npm run dev:sample-images` (labelled SAMPLE images, refuses non-local projects).
- Known: the cart's “Proceed to checkout” goes to `/checkout`, built in Phase 3.

## Phase 3 — checkout & bank transfer (verified)

Verified with `npm run test:smoke:checkout` (37 browser checks against local Supabase) plus all previous suites.

- `/checkout`: contact + delivery/pickup form, live summary, server action `placeOrder` → Zod → rate limits (IP 10/10 min, phone 5/10 min) → `create_order`. Idempotency key per attempt (sessionStorage) so double-submits never create two orders. Field-level translated errors; stock problems link back to the basket.
- Order access: 256-bit token in an httpOnly cookie (`ord_<id>`, 60 days) for the buying browser + private link `?t=` for other devices. The order URL itself never carries the token; `/order-success/*` sends `Referrer-Policy: no-referrer` and `no-store`.
- `/order-success/[orderId]`: bank details snapshotted on the order, exact amount, copy buttons, payment deadline (Addis Ababa time), numbered instructions, tracking code (shown to the buying browser), private link, status banners (pending / rejected with reason / confirmed / expired / cancelled), order history, items & totals.
- Receipt upload: server issues a one-time signed upload URL to `payment-receipts/orders/<id>/<uuid>.<ext>` → browser uploads directly to Storage → server downloads, checks magic bytes vs. extension, size, SHA-256 → `submit_payment`. Anything failing verification or the DB call is deleted. Receipts are never publicly reachable.
- `/track-order`: order number + tracking code, rate-limited (IP 10/15 min, order 5/15 min), returns status/items/total/history only — no name, phone or address.
- `/api/cron/expire-orders` (Bearer `CRON_SECRET`, constant-time) + `vercel.json` daily cron; checkout also expires overdue orders opportunistically so stock frees up between cron runs.
- New error codes: `invalid_reference`, `upload_too_large`, `upload_invalid_type`, `upload_failed` (EN + AM).
- Fixed: React 19 form reset cleared the tracking form; mobile overflow on the order page; missing terms link; lint failure in the Phase 2 smoke script (`.cjs` override).

## Decisions made (change if you disagree)

1. Customers are guests (no accounts). Staff are the only Supabase Auth users; public sign-ups disabled.
2. Stock is **reserved at order creation** and released on cancel/expiry (default payment window 24 h, editable in settings).
3. Managers may verify payments (see permission matrix note in ARCHITECTURE.md §3).
4. Order tracking = private link token, or order number + 10-char tracking code (rate-limited).
5. Uploads over Vercel's 4.5 MB body limit use Supabase signed upload URLs + server-side verification.
6. Printing price = pages × copies × per-page rule (color/size/sides) + flat service charge.
7. Carts are client-side; the server recomputes everything.

## Needed from the business owner before production

- [x] Business name: **Abiye** (Amharic: አብዬ, confirmed)
- [ ] Logo, brand colors (if different from emerald/gold)
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
- `src/lib/supabase/database.types.ts` is generated from the local stack (`npm run db:types`); regenerate after every migration.
- Content-Security-Policy deferred to Phase 7.
- `/admin/login` must validate the `next` redirect parameter (same-origin `/admin/...` only) — Phase 4.
- Vercel Hobby allows only daily cron jobs, so `vercel.json` runs expiry daily (03:17 UTC); on Vercel Pro change it to hourly. Checkout also expires overdue orders on every new order.
- Orphaned receipt uploads (signed URL issued but never submitted) are not yet cleaned up; add a storage sweep to the cron in Phase 7.
- No customer notification channel yet (SMS/Telegram to customers) — customers check the order page or /track-order.

## Next session: start Phase 4 (admin dashboard)

1. Read `AGENTS.md` (Next.js 16 rules), this file, and `docs/ARCHITECTURE.md`.
2. Run `npm run dev:up` — starts Docker if the sandbox restarted, then local Supabase, then checks the API (data persists in Docker volumes). A "cannot connect to Docker" / curl exit 7 at session start just means this hasn't run yet. If the DB was reset: `npm run dev:sample-images` (needs `NODE_PATH=$(npm root -g)`).
3. Build `/admin/login` (safe `next` redirect), admin layout + navigation from `ADMIN_ROUTES`, dashboard, products/images, categories, inventory, orders (status, assign, notes), payments review (signed receipt URLs), customers, staff, settings (business, banks, delivery zones, homepage), and a `create-super-admin` script.
4. Browser tests: `npm run test:smoke` and `npm run test:smoke:checkout` (app on :3100, `NODE_PATH=$(npm root -g)`), plus `npm run check` and `npm run test:db`; update this file.
