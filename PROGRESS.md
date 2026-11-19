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
| 4 — Admin dashboard | ✅ Complete (2026-11-19) |
| 5 — Printing services | ✅ Complete (2026-11-19) |
| 6 — Telegram integration | ✅ Complete (2026-11-19) |
| 7 — Finalization & deployment | ⏭ Next |

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

## Phase 4 — admin dashboard (verified)

Verified with `npm run test:smoke:admin` (50 browser checks across Super Admin, Manager and Staff sessions), plus 161 SQL assertions, 97 unit tests and the storefront/checkout suites.

- `/admin/login` (generic errors, rate-limited per IP + email, non-staff accounts signed straight out, `?next` restricted to same-site `/admin` paths), sign-out, `/admin/account` password change.
- Shell: sidebar filtered by permission, order search, pending-payment badge, mobile menu. The layout is presentation only — every page calls `requirePermission()` and every action re-checks; RLS applies to all queries (user-session client).
- Dashboard: `admin_dashboard_stats()` (migration 0012) — revenue only with `analytics.view`, staff counts only assigned orders; 14-day bar chart (validated `--chart-1` colour, tooltips, screen-reader table); recent orders.
- Orders: list (status filter, search by order no./phone/name, pagination), detail with receipts via 5-minute signed URLs, verify/reject, state-machine buttons, cancel with reason (+ paid-order warning), assignment, internal notes, merged history.
- Payments queue: to verify / verified / rejected, receipt preview, flags reused transaction references.
- Products: list/filter, create/edit (EN + AM), images (browser → Storage, server verifies content, main image), archive/restore, delete only if never ordered.
- Categories, Inventory (adjust with reason, low/out filter, movement history), Customers (list/search, detail with orders & addresses).
- Staff: create accounts with one-time temporary password, change role, remove access (immediate), reset password; profile grant via `admin_create_staff_profile()` (migration 0013, audited).
- Settings: business/contact/hours/social, logo & hero image, homepage texts, delivery (pickup/delivery toggles, free-delivery threshold, payment window, cities & fees), bank accounts (Super Admin only), printing settings.
- `npm run admin:create -- --email … --name "…"` creates the first Super Admin (hidden prompt / ADMIN_PASSWORD / generated once).
- Fixed along the way: React form auto-reset wiping admin input on validation errors; success toast lost when the action removed its own form; `db:types` script silently writing an empty file; mobile overflow on the dashboard.

Local dev admin: `owner@abiye.local` / `LocalDevOwner2026` (local Docker database only — never used anywhere else).

## Phase 5 — printing services (verified)

Verified with `npm run test:smoke:printing` (37 browser checks) plus all other suites (storefront 40, checkout 37, admin 50), 168 SQL assertions and 101 unit tests.

- `/printing`: live price list + online order form (PDF, DOCX, JPG, PNG; up to 10 files; size limit from settings ≤ 25 MB). Instant estimate in the browser (pdf-lib loaded on demand); the server's page count is authoritative.
- Upload flow: signed upload URLs to `printing-files/jobs/<jobId>/` → server re-downloads every file, checks content type vs. extension and size, counts PDF pages (`src/lib/printing/page-count.ts`), images = 1 page, DOCX → staff quote → `create_printing_job`. Any failure deletes all of the job's files.
- `/printing/jobs/[jobId]` (token cookie or private link, no-referrer): status, price breakdown or "preparing your quote", add to basket, link to its order, files + retention date, progress.
- Basket/checkout carry printing jobs (`{ type: "printing", printingJobId, accessToken }`), re-validated on the server; non-payable jobs block checkout. Payment moves jobs to Payment verification → Printing automatically.
- Admin `/admin/printing`: tabs (needs action / waiting / done), nav badge, job page with 5-minute signed downloads, quote form (pages → price list, or manual total), ready / collected / back-to-printing / cancel, delete files now (blocked while in production). `/admin/printing/prices` editor (`printing.pricing`).
- Retention: migration 0014 (`printing_files_due_for_deletion`, `mark_printing_files_deleted`, `admin_mark_printing_files_deleted`, paper-size check) + `/api/cron/printing-retention` (daily in `vercel.json`). Files are never deleted while a job is being paid for or produced.
- Secret-key Supabase client is now typed with the database schema.

## Phase 6 — Telegram (verified)

Verified with `npm run test:smoke:telegram` (31 checks against a mock Telegram Bot API; the test starts its own app on :3101) plus all other suites.

- `src/lib/telegram/format.ts`: HTML-escaped message builders for new order (the required layout), payment resubmitted (+ reused-reference warning), printing request (priced / needs quote), payment verified / rejected, order cancelled (+ refund warning), test message; admin deep links.
- `client.ts`: sendMessage / sendPhoto / sendDocument, 20 s timeout, error classes (retry, rate-limited, permanent); token never logged.
- `dispatch.ts`: claim (SKIP LOCKED) → send → complete; receipt sent as photo (PDF/large → document) in ONE call with the text as caption so retries cannot duplicate text; stops a batch on 429; `dispatchSoon()` uses `after()` so alerts go out right after the customer/admin request.
- Wired into: payment proof submitted, printing request, payment verified/rejected, order cancelled.
- `/api/cron/notifications` safety net (daily on Hobby — see DEPLOYMENT §4 for faster options).
- `/admin/notifications` (settings.manage): configured status, send test message, recent queue with errors, Retry for failed/dead (migration 0015: `admin_notifications`, `admin_retry_notification`, `admin_queue_test_notification`).
- Verified: alert arrives without cron; photo + caption content; HTML injection escaped; outage → retry with backoff → delivered once; 429 handling; 3 parallel workers send 6 messages exactly once; admin test/retry; rejection & cancellation alerts; token never in DB or logs.

## Pre-launch additions (requested 2026-11-19) — verified

Verified with `npm run test:smoke:account` (44 checks incl. real confirmation/reset emails via the local mail catcher) and all other suites updated for sign-in (storefront 40, checkout 37, admin 50, printing 37, Telegram 31), 199 SQL assertions, 129 unit tests.

- **Customer accounts (email + password, confirmed by email)** — owner's choice. Pages: `/account` (my orders, my printing jobs, name/phone), `/account/login`, `/account/signup` (must accept terms & privacy), `/account/forgot-password`, `/account/reset-password`; `/auth/confirm` handles email links (token_hash, works cross-device). Header account icon.
- **Only signed-in customers can order**: checkout and printing require sign-in (redirect with safe `next`); enforced in the server actions AND the database (migration 0016: `create_order_for_user` / `create_printing_job_for_user`, base functions revoked from service_role, BEFORE INSERT trigger refuses orders/jobs without a confirmed user). Orders/jobs record `user_id`; customers read only their own (RLS); owners can open/pay their orders from any device.
- Checkout: prefilled from the account, "I agree to the terms" required (also checked server-side), phone/name saved back to the account.
- **Bank details on the shop**: Contact page "How to pay" (all active accounts, copy buttons) + primary account in the footer — from admin Settings → Bank accounts.
- **Social / contact links**: phone, email (e.g. Gmail), WhatsApp, Telegram, Instagram, TikTok, Facebook — brand icons in the footer and cards on Contact; edited in admin Settings (https-only links).
- **Terms & privacy editable in admin** (Settings → Terms & privacy, EN + AM, "approved" switch hides the draft banner); rendered as plain text only.
- Local dev: sign-ups + email confirmation on, local mail catcher on :54324 (dev:up no longer excludes it).
- **Production TODO for the owner**: configure SMTP + email templates + URL configuration in Supabase (docs/DEPLOYMENT.md §2b).

## Browser-only deployment (owner preference, 2026-11-19)

The owner does not run anything from a personal computer. Production database setup is `supabase/production-setup.sql` (generated by `npm run db:bundle`: all migrations + category starter + migration bookkeeping, one transaction, refuses to re-run) pasted into the Supabase SQL Editor. Verified on a brand-new Supabase instance: applies cleanly, re-run refused, then all 199 SQL assertions pass. First Super Admin via dashboard + one SQL call (DEPLOYMENT §3). Future migrations: give the owner the new file(s) to paste in order.

**Migrations applied in production by the owner:** 0001–0016 (via production-setup.sql), 0017 (SQL Editor, 2026-11-19). Pending: none. Website live on Vercel (`fantaf.xyz`); Super Admin `fantaf.transport@gmail.com` signs in.

Owner progress so far: Resend domain `fantaf.xyz` + Supabase SMTP + URL configuration (`https://fantaf.xyz`) + 3 bilingual email templates done.

## Decisions made (change if you disagree)

1. ~~Customers are guests~~ → **changed 2026-11-19 at the owner's request: customers must sign up (email + password, email confirmed) to order.** Admin access still requires a Super Admin-created staff profile.
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
- Orphaned uploads (signed URL issued but never submitted — receipts and printing files) are not yet cleaned up; add a storage sweep to the cron in Phase 7.
- Word (.docx) page counts are not automatic (layout-dependent); staff quote them. Customers are not messaged when a quote is ready — they revisit the job link (saved on the job page), or staff call them.
- No customer notification channel yet (SMS/Telegram to customers) — customers check the order page or /track-order.

## Next session: start Phase 7 (finalization)

1. Read `AGENTS.md` (Next.js 16 rules), this file, and `docs/ARCHITECTURE.md`.
2. Run `npm run dev:up` — starts Docker if the sandbox restarted, then local Supabase, then checks the API (data persists in Docker volumes). A "cannot connect to Docker" / curl exit 7 at session start just means this hasn't run yet. If the DB was reset: `npm run dev:sample-images` and `ADMIN_PASSWORD=LocalDevOwner2026 npm run admin:create -- --email owner@abiye.local --name "Abiye Owner"`.
3. Phase 7 scope: promotions + homepage banners admin (`/admin/promotions`), analytics page (`/admin/analytics`: daily/weekly/monthly sales, by category, best sellers, status distribution, inventory status — real queries), Content-Security-Policy (nonce), orphaned-upload sweep in a cron, security review (`/security-review`), accessibility + mobile pass, convert smoke scripts to a Playwright test project if desired, production deployment checklist, and owner hand-off notes.
4. Tests: `npm run check`, `npm run test:db`, then with the app on :3100 (`npx next start -p 3100`) and `NODE_PATH=$(npm root -g)`: `npm run test:smoke`, `test:smoke:checkout`, `test:smoke:admin`, `test:smoke:printing`, `test:smoke:account`; and `npm run test:smoke:telegram` (starts its own app on :3101). Clear `rate_limits` between runs if needed. Update this file.
