# Project Progress

Living tracker so work can continue across sessions. **Update this file at the end of every work session.**

- Architecture & plan: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Setup & deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Courier / Business app privacy + delivery monitor (requested 2026-11-25)

- Migration **0074** `20261125000074_delivery_monitor.sql`: `courier_deliveries` / `partner_orders` without products or prices (order number + customer name; phone / address only while needed); trigger `orders_wrong_pin` logs every wrong PIN (`pin_wrong`) and sends `delivery_pin_alert` (security group) at the Nth try (setting `wrong_pin_alert`, default 3); `private.delivery_overdue()` + `delivery_monitor_scan()` → `delivery_alert` (orders group, deduped per order/kind/step); `public.delivery_monitor_tick()` (staff or service role, at most every 5 min); `admin_delivery_monitor()`, `admin_set_delivery_monitor()`; settings key `delivery_monitor`.
- App: tick after admin / courier / Business layouts and in the daily notifications cron; Admin → **Delivery monitor** (Now, Couriers & shop staff, App log, Alert settings); Telegram formats for both alerts.
- Tests: db `99zzzj_delivery_monitor_test.sql` (14), `99zzzi` updated; unit telegram format; e2e `partner.smoke.cjs` (30).
- ⏳ Owner: apply 0074.

## Payment details for staff (requested 2026-11-25)

- Payment review page (Admin → Payments → a payment) and the Telegram payment alerts (waiting / resubmitted / verified) list every product with quantity, unit and line price, subtotal, delivery fee (city, partner shop, % off the full city price), promo code discount and total — read fresh from the order (`src/lib/orders/breakdown.ts`). A receipt with a message too long for a photo caption is sent as a file, then the full message.
- No Telegram alert for a waiting payment = the "Also alert order payments waiting for approval" switch (Admin → Notifications → Telegram activity feed) is off by default; approved payments are always sent.

## Phase 2: partner shops — Abiye Business app (requested 2026-11-24)

- Migration **0073** `20261124000073_partner_shops.sql`: permission set **Partner shop** (`partner.own`) + `partners.manage` (Super Admin); `partner_shops`, `partner_staff`, `partner_earnings`, `partner_payouts` (RLS: own shop or partners.manage); orders `partner_shop_id`, `partner_snapshot`, hand-over PINs (`handoff_courier_code` / `handoff_shop_code`, `handoff_*_at`, `handoff_tries`, `at_shop_at`); `create_order` accepts `fulfillment.partner_shop_id` (pickup, city price + discount); `admin_assign_courier` / `admin_dispatch_orders` include partner orders; `courier_deliveries` shows the shop (not the customer); `courier_handoff` + `partner_receive` (both PINs → ready_for_pickup, courier earns), `partner_hand_over` (customer PIN → completed, shop earns handling fee); `partner_orders`, `partner_me`; admin `admin_partner_shops`, `admin_save_partner_shop`, `admin_partner_staff`, `admin_set_partner_staff`, `admin_pay_partner`, `admin_partner_orders` + export kind `partner_orders`; reset clears partner earnings/payouts. New errors `handoff_locked`, `invalid_pickup_point`.
- App: optional 5th address `BUSINESS_HOST` (until set, partner staff use the courier address); `/business` app (Orders, Earnings, My shop, installable "Abiye Business"); courier hand-over UI; checkout "Pick up at a partner shop" with full shop details; order page shop + pickup PIN; emails (on the way to the shop / ready at the shop with PIN); Admin → **Partner shops** (shops, staff, add, Excel) + shop page (details, open orders, pay); dispatch and order page show the partner shop / hand-over status.
- Tests: db `99zzzi_partner_shops_test.sql` (35 checks), unit `hosts.test.ts`, e2e `partner.smoke.cjs` (27 checks). All 42 browser suites, unit tests and db tests pass.
- ✅ 0073 applied in production (owner confirmed 2026-11-24). ⏳ Owner: add `business.abiye.site` (domain, Supabase redirect URL, `BUSINESS_HOST`) — see DEPLOYMENT.md §6b-1.

## Couriers & staff phase 1 (requested 2026-11-24)

- Migration **0071** `20261124000071_couriers_staff_phase1.sql`: no Telegram for duty changes (audit entity `courier`); vehicle set by admin (on_foot / bicycle / motorcycle / car; motorcycle & car require make, model, plate, insurance, licence); `staff_hr` (Fayda, passport optional, emergency contact…; staff.manage; values never logged); ~85 Ethiopian cities as inactive delivery zones; couriers go on duty for chosen cities (`courier_set_duty(on, zone_ids)`); `delivery_discounts` steps (Super Admin) applied in `create_order` (order keeps `delivery_fee_full_etb`); courier earns the full city price; `courier_decline` (back to dispatch, off duty); `app-sounds` bucket + ringtone; `admin_courier_orders` + export kind `courier_orders`.
- App: courier duty page (cities), ringer (20 s refresh, ringtone or built-in, vibrate), decline, phone-only profile; admin Online now / Dispatch by city / Ringtone / Excel; courier vehicle & documents; Staff → HR details; checkout shows the delivery discount; CSP media-src allows the storage address.
- Tests: db `99zzzh_courier_earnings_test.sql` (rewritten), unit `money-pricing.test.ts`, e2e `courier.smoke.cjs` (52 checks). Seed: sample cities replace the inactive copies.
- ✅ 0071 applied in production (owner confirmed 2026-11-24).
- Migration **0072** `20261124000072_delivery_discount_by_amount.sql`: delivery discount steps are now by purchase amount (`{min_amount_etb, percent}`, products + printing before promo), `private.delivery_discount_pct_for_amount`; old item-count steps cleared/ignored. ✅ applied in production (owner confirmed 2026-11-24).

## Customer approval, courier app v2, Couriers & delivery (requested 2026-11-24)

- **Approval** (migration **0069** `20261124000069_customer_approval.sql`): `customer_accounts.approval_status` (existing approved, new pending); `private.assert_confirmed_user` refuses pending (`account_pending`) → no orders / printing / top-ups / reviews / stock alerts; support allowed. Permission `customers.approve`; Admin → **Account approvals**: approve (email) / reject with reason (email sent directly, email blocked, account deleted). Security group alert `account_pending`. Shop notice on every page. Invited customers approved at once (`approve_invited_customer`, service role). Test helpers approve test customers.
- **Courier app v2 + admin** (migration **0070** `20261124000070_courier_earnings.sql`): `courier_profiles` (phone, vehicle, plate, own fee, on duty), fixed fee per delivery (`website_settings.courier`, default 100 ETB), `courier_earnings` (one per delivered order), `courier_payouts` (Mark as paid), `courier_notifications`; courier tabs Deliveries / Earnings / Notifications / Profile + on-duty switch; Admin → **Couriers & delivery** (Dispatch, Couriers, Fee) + courier page (details, own fee, unpaid → Mark as paid, payments). Permission `couriers.manage` (Super Admin).
- Tests: db `99zzzg_customer_approval_test.sql`, `99zzzh_courier_earnings_test.sql`; e2e `approval.smoke.cjs`, `courier.smoke.cjs`, `account.smoke.cjs`.
- ✅ 0069 and 0070 applied in production (owner confirmed 2026-11-24).

## Domain move fantaf.xyz → abiye.site (requested 2026-11-24)

- No code change needed (all addresses come from `APP_URL` and `*_HOST`); docs, comments and tests renamed to abiye.site. Owner checklist: **docs/DOMAIN-MOVE.md** (Vercel domains + DNS, Resend domain, Supabase URLs, env switch, old addresses redirected, checks).
- ✅ Owner moved to abiye.site (domains, Resend, Supabase URLs, env, redeploy) — 2026-11-24. Resend: new API key for abiye.site (the old key was limited to fantaf.xyz → HTTP 403); failed emails retried and sent. Remaining: old fantaf.xyz addresses set to redirect (step 5) and the remaining checks (step 6).

## Current status

| Phase | Status |
|---|---|
| 1 — Planning & foundation | ✅ Complete (2026-11-18) |
| 2 — Customer storefront | ✅ Complete (2026-11-18) |
| 3 — Checkout & bank transfer | ✅ Complete (2026-11-19) |
| 4 — Admin dashboard | ✅ Complete (2026-11-19) |
| 5 — Printing services | ✅ Complete (2026-11-19) |
| 6 — Telegram integration | ✅ Complete (2026-11-19) |
| 7 — Finalization & deployment | ✅ Complete (2026-11-19) — owner go-live checklist: docs/GO-LIVE.md |

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

## Staff change-password page (requested 2026-11-23)

- `/admin/password` on the staff, operations and courier addresses (not on the customer address), linked under the sign-in form: email → current password → **authenticator code** (so a stolen password alone cannot change it) → new password twice → Save → Done; signed out everywhere afterwards. Wrong-address accounts refused; rate-limited; failures are security events (`src/lib/auth/password-change.ts`). No database change.
- Tests: e2e `courier.smoke.cjs` (wrong code refused, Done, other session signed out, old password refused, new one works).

## Courier app installable on phones (requested 2026-11-23)

- Courier address: own manifest ("Abiye Courier", start `/courier`, scope `/` so sign-in stays in the app, maskable icon), iPhone home-screen name per address (`src/lib/security/app-meta.ts`), offline page allowed on every address, "Install the courier app" card (`CourierInstallCard`; Android prompt / iPhone steps; hidden once installed), app opens counted (App installs). Staff/Super Admin addresses install as "Abiye OCS" / "Abiye Operations".

## Separate addresses + courier app (requested 2026-11-23)

- **Addresses** (`src/lib/security/hosts.ts`, proxy, guards, sign-in): `fantaf.xyz` customers · `ocs.fantaf.xyz` managers/staff · `operations.fantaf.xyz` Super Admin only · `courier.fantaf.xyz` couriers only. Switched on only when `CUSTOMER_HOST`, `STAFF_HOST`, `SUPER_ADMIN_HOST`, `COURIER_HOST` are all set in Vercel. Wrong-address sign-in refused + security event; every admin request re-checked; per-address app manifest; Telegram admin links use ocs / operations. Docs: DEPLOYMENT.md §6a.
- **Courier** (migration **0068** `20261123000068_courier.sql`): permission set Courier (`deliveries.own`); admin assigns delivery orders (order page → Courier); 4-digit delivery code for the customer (order page + "on its way" email); courier app `/courier`: Picked up → Delivered (code) / Couldn't deliver (reason); 5 wrong codes lock; contact details only while open; Activity log + Telegram `delivery_update`; courier idle sign-out 30 min. Docs: §6b.
- Tests: db `99zzzf_courier_test.sql`, unit `hosts.test.ts`, e2e `courier.smoke.cjs` (own server with the split on, `*.fantaf.test`).
- Later: courier KPIs on the Performance dashboard; optional photo proof.
- ✅ 0068 applied; subdomains, Supabase redirect URLs and the four `*_HOST` variables set in production (owner confirmed 2026-11-23).

## Customer app tidy-up, About us editor, printing payment alert (requested 2026-11-23)

- Contact page: "How to pay" / bank accounts removed (shown at checkout and on the top-up page).
- Profile: Notifications row removed (it is in the side menu above Support & feedback).
- Header: no separate "Shop" link (Home has everything; search still uses /shop).
- **My orders** replaces Track order: each order has a **Track** button (its status page); side menu shows My orders only; `/track-order` redirects to My orders; the old track-by-number form and action were deleted.
- **About us** editable in Admin → Settings → About us (title, text with `## ` sections and `{name}`, show services / why-us); plain text only. Empty → standard description.
- **Printing payment receipt → orders & payments Telegram group always** ("🖨 PRINTING ORDER — PAYMENT TO VERIFY"), even with the pending-payment switch off; product orders follow the switch. Documents still go to the printing group only after approval.
- Migration **0067** `20261123000067_printing_payment_alert_about.sql`; tests `99zzzd_printing_payment_alert_test.sql`, unit format test, e2e account / checkout / member-id / storefront / wallet.
- ⏳ Owner: paste **0067** into the Supabase SQL Editor.

## Upload size vs the Cloudmersive plan (3.5 MB) (requested 2026-11-23)

- Limit = `CLOUDMERSIVE_MAX_MB` (Vercel, optional; default 3.5). Server refuses larger files before scanning with `scan_too_large` (clear message with the limit; not counted as an outage; nothing sent to Cloudmersive; HTTP 413 from Cloudmersive mapped the same way).
- Browser: `src/lib/upload/shrink-image.ts` makes large JPG/PNG photos smaller before upload (receipts → ≤ 1.5 MB JPG, max 2000 px; print images only when over the limit, max 3500 px, quality ≥ 0.8). Top-up, payment and printing forms show "Largest file: N MB".
- Tests: unit `virus-scan.test.ts` (too_large), e2e `wallet.smoke.cjs` (8 MB photo → 1.2 MB JPG accepted; 4 MB PDF → clear message, no scan, no outage alert).

## Virus-scan history in our own database (requested 2026-11-23)

- Every scan of a customer upload is kept in `upload_scans` (1 year): User ID, upload type, file type / size, fingerprint (sha256), result (clean / blocked / scanner unavailable), findings, scan time. Written only by the server; staff read-only; customers none.
- **Admin → Security → File scans**: list with counts, search by User ID / fingerprint / finding, result filter, dates.
- Payment, top-up and printing pages show **"Virus scan: clean (Cloudmersive, time)"** for their exact file (matched by fingerprint).
- Migration **0066** `20261123000066_upload_scan_history.sql`; tests `99zzzc_upload_scan_history_test.sql`, `wallet.smoke.cjs`.
- ✅ 0066 applied in production; first real scan recorded (clean, 0.7 s) — owner confirmed 2026-11-23.

## Virus scan of customer uploads — Cloudmersive (requested 2026-11-23)

- Payment receipts, wallet top-up receipts and printing documents: after the content-type check, every file goes to Cloudmersive's **advanced virus scan** (`src/lib/security/virus-scan.ts`, `upload-scan.ts`). Strict: no viruses, executables, scripts, macros, HTML, XXE, insecure deserialization, invalid files, **password-protected files** (owner's choice), only the expected format.
- Not clean → file deleted, customer told "failed our security check", security event `upload_blocked` (Security page + security Telegram, User ID + what was found; the account becomes high-risk).
- **Fails closed** (owner's choice): key missing / wrong, limit reached or outage → upload refused ("try again in a few minutes"), event `scan_unavailable`; Site health shows the scanner status.
- Env: `CLOUDMERSIVE_API_KEY` (Vercel, Sensitive). `CLOUDMERSIVE_API_BASE` only for tests. Tests use a local fake scanner: `node tests/e2e/fake-scanner.cjs` (port 4610) with `.env.local` `CLOUDMERSIVE_API_KEY=test-cloudmersive-key`, `CLOUDMERSIVE_API_BASE=http://127.0.0.1:4610` — start it before the browser tests.
- Migration **0065** `20261123000065_upload_virus_scan.sql`; tests: unit `virus-scan.test.ts`, db `99zzzb_upload_scan_test.sql`, e2e `wallet.smoke.cjs`. Docs: DEPLOYMENT.md §6b.
- ✅ 0065 applied in production and `CLOUDMERSIVE_API_KEY` added in Vercel (owner confirmed 2026-11-23).

## Promotion alerts (security group) and Excel copies through the queue (requested 2026-11-23)

- **Security Telegram group** gets every promotion change: created, changed (what changed), switched on / off, revoked (reason), brought back, deleted, code given to / removed from a customer (User ID, reason), and **code used** when the order is paid (User ID, order, original price, discount, price paid). Who acted = Action by User ID.
- **Every Excel download** → the file with an alert in the **receipts** group, now through the notification queue: the file waits in the private `excel-exports` bucket, is retried if Telegram fails (visible under Notifications), and is deleted from storage once sent. Needs the receipts bot set up in Vercel (`TELEGRAM_RECEIPTS_BOT_TOKEN`, `TELEGRAM_RECEIPTS_CHAT_ID`).
- Migration **0064** `20261123000064_promotion_alerts_excel_queue.sql`; tests `supabase/db-tests/99zzz_promotion_alerts_test.sql`, `tests/e2e/telegram-feed.smoke.cjs`, unit `telegram-format.test.ts`.
- ✅ 0063 and 0064 applied in production (owner confirmed 2026-11-23).

## Excel of promotion uses (requested 2026-11-23)

- **Promotions → Excel** (and Excel exports page → Promotion uses), Super Admin only: every order paid with a promo code whose payment was approved in the chosen dates — User ID, order, promo code, promotion, for whom, discount rule, items, products / delivery, **original price**, **discount**, **price after discount**, paid with, order status, ordered, payment approved, promotion now (active / off / revoked). Copied to the receipts Telegram group like every Excel.
- Migration **0063** `20261123000063_promotion_uses_export.sql` (`admin_promotion_uses`; export kind `promotions`).
- ✅ 0063 applied in production (owner confirmed 2026-11-23).

## Promotion rules: audience, once per customer, revoke / remove with a reason, Super Admin delete (requested 2026-11-23)

- **Who can use it:** Every customer, or Selected customers only (personal code, given by User ID or email). A personal code given to customers cannot be switched to "every customer".
- **Once per customer** for every code (database constraint). A use counts once the **payment is approved**: the personal code is marked used (with the order number) and disappears from the customer's My offers. An order waiting for payment holds it ("order waiting for payment"); a cancelled / expired / rejected order frees it.
- **Revoke** (anyone with Promotions) needs a reason: the code stops working at once, the reason is shown on the promotion and in the Activity log. Only the Super Admin can bring a revoked promotion back (tick Active and save).
- **Remove a code from a customer** needs a reason (recorded in the Activity log); not possible once used or while an order waiting for payment has it.
- **Delete:** Super Admin only (with two-step sign-in), only when never used and nobody holds it — remove it from its customers first. Old expired / cancelled orders no longer block the delete (fixes "used 0 / 1" but "was used in orders").
- Holders listed by User ID only. Help page updated (once per account; top-up reason "Top Up").
- Migration **0062** `20261123000062_promotion_rules.sql`; tests `supabase/db-tests/99zzy_promotion_rules_test.sql`, `tests/e2e/personal-promo.smoke.cjs`.
- ✅ 0062 applied in production (owner confirmed 2026-11-23).

## Top-up page, wallet at checkout, Excel for Super Admin only (requested 2026-11-23)

- Customer: **My balance → Top up** opens `/account/wallet/top-up` with Abiye's bank accounts (copy buttons), the steps (reason **"Top Up"**, type the **exact** amount, upload the receipt) and the request form.
- Checkout: pay with the balance or by bank transfer; when the balance is too small a **Top up** link is shown.
- Admin Wallet: one search (User ID, email/name on Balances; User ID, top-up number or reference on the top-up tabs); top-up lists show User ID and amount; **Excel** button for the Super Admin only.
- **Every Excel download is Super Admin only** (with two-step sign-in): all export routes check the role, Excel buttons are hidden for other roles, the Excel exports page is hidden, and `admin_log_export` refuses anyone else (migration **0061** `20261123000061_super_admin_exports.sql`, which also lets the balances search match a User ID).
- ✅ 0061 applied in production (owner confirmed 2026-11-23).

## Telegram alerts: User ID only, type, who acted, suggested action (requested 2026-11-23)

Migration **0060**: `notifications_outbox_telegram_enrich` (BEFORE INSERT, telegram) adds `user_id` (customer / account the alert is about — from order, printing job, top-up, ticket, audit entry, notification recipient or security email) and `by_user_id` (staff who acted — audit actor or decided_by).
- `buildMessage` (format.ts): line 2 "Service: … · Type: …", then "User ID" and "Action by User ID"; name / phone / email / "by name" lines are dropped (a security alert keeps the email tried when it is not an account); "👉 Suggested action" per type (`suggestedAction`) before the admin link. Excel export copies: "Action by User ID" + suggested action (`sendExportCopy` now takes the staff user id).
- Unit (telegram-format), SQL 99zzx, browser telegram / telegram-feed updated.

## Top-ups in Telegram at every step (requested 2026-11-23)

Migration **0059**: orders & payments group gets "💰 Top-up to verify" when the receipt is attached (always on — `pending_payments` now only covers order payments), "✅ TOP-UP APPROVED" (0058) and "❌ TOP-UP REJECTED" with the reason (`topup_rejected`). SQL 99zzx/99zzk + browser wallet.

## Customer app: side menu + Profile page with theme (requested 2026-11-23, reference screenshots)

No migration. Layout pattern from the owner's reference app, in Abiye's own colours and content (no copied name / logo / images).
- **Side menu** (`AccountMenu` in header-client.tsx, opened by the ☰ menu icon at the top left; rendered in a portal so the sticky header does not clip it; id `account-menu` kept): green header with initials avatar, name and "View profile" (signed out: Sign in / Create account); rows My balance, My orders, Track order, My offers, Notifications, Support & feedback, Help, About us, Contact; printing card at the bottom (when printing is on). Closes on navigation / Escape / backdrop.
- **Profile** (`/account/profile`): avatar, name, email, User ID; Personal details, **Theme** (Light / Dark / Auto = phone setting; cookie `theme`, applied by the root layout + `ThemeSync`), Notifications, Saved delivery address; App version (package.json), Privacy policy, Terms; Sign out. Linked from My account ("Profile").
- Root layout: Ethiopic font removed (English only).

## English only — Amharic removed (requested 2026-11-23)

No migration. The website, emails, phone notifications and Supabase auth emails are English only.
- `src/i18n/request.ts` always uses English (an old NEXT_LOCALE=am cookie or Amharic browser is ignored); the language switch and `setLocale` were removed. messages/am.json and the Amharic texts in content/ and the DB columns (*_am) stay but are not used.
- Emails: no Amharic section, no " / Amharic" in subjects or detail labels (`englishOnly`); push: always English. Auth templates (supabase/templates/*.html, config.toml subjects, DEPLOYMENT.md) English only — **the owner should re-paste the three templates and subjects in Supabase → Authentication → Emails**.
- Admin forms no longer show Amharic fields (products, categories, promotions, banners, cities, bank instructions, settings, services, legal texts); `formObject` fills any missing `*_am` with the English text, so required DB columns stay valid.
- Offline page English only.

## Approved top-ups announced in Telegram (reported 2026-11-23)

Migration **0058**: `wallet_topups_telegram_approved` → `topup_verified` ("✅ TOP-UP APPROVED": number, amount, reference, User ID, new balance, approved by) in the orders & payments group. Before, a top-up only reached Telegram as "waiting for approval" (off since 0057) or as the receipt file in the receipts group. SQL 99zzx + browser wallet check.

## Telegram only after approval; User ID numbers only (requested 2026-11-23)

Migration **0057**. SQL 99zzx/99zzk/99zzp/99zzv/99zzf updated (test helper switches the waiting-for-approval alerts on); browser push/telegram/telegram-feed updated; list tests match the bare number.
- **Printing documents → printing group only once the payment is approved** (job → printing; `stage: paid`), as before 0052. A rejected payment's documents are deleted without a Telegram copy.
- **Alerts for payments / top-ups waiting for approval** (`new_order`, `payment_resubmitted`, `wallet_topup`) are a switch, **off by default** (`telegram_feed.pending_payments`, Notifications → Telegram "Also alert payments and top-ups waiting for approval"; `admin_set_pending_payment_alerts`). Approved payments (`payment_verified`, receipts) are still sent; waiting ones show as red counts. `admin_set_telegram_feed` now merges instead of replacing.
- **User ID numbers only** in admin lists (`UserIdLink` shows just the number, aria-label "User ID …", links to the person); column headers "User ID"; KPI table and target picker show only the number.

## Orders exist only once paid; staff performance KPIs with targets (requested 2026-11-23)

Migration **0056**. SQL `99zzx_*` (+96/97 updated: no "order placed" email); browser `test:smoke:kpi` (new, 5), emails/wallet/printing updated.
- **Only accepted payments make an order** (customer and staff): no customer email / phone message for a checkout that is placed, expires or is cancelled before payment (`email_order_event`); the payment details stay on the checkout page. My orders lists paid orders only, with a small "Waiting for payment" box (checkouts in their 30 minutes / under review, printing requests waiting for a price or payment) so the customer can finish paying. Admin Orders list = payment verified / refunded (pending receipts are under Payments); Printing tabs: "To print / hand over" and "Needs a price" (no "payment to approve"). Dashboard counts accepted orders. Wallet page: a top-up appears once accepted (history); one being checked is a one-line notice; rejected ones are not listed (the customer is emailed the reason).
- **Staff performance** (`/admin/performance`, kpi.view: Super Admin + Manager; targets kpi.manage: Super Admin): `admin_staff_kpis(from, to)` per staff member — tickets resolved (status → resolved/closed by them), ticket resolution time, first reply time, replies, rating of their tickets, orders completed / order steps, payments approved / rejected + review time, top-ups approved / rejected, printing jobs completed, in-store sales (count + ETB). Targets (`kpi_targets`, per day / week / month, everyone or one person, audited) — counts scaled to the viewed dates, times are a maximum; % reached with green / amber / red. Excel (kind `kpi`, also on Excel exports).
- Fix: User ID lookups for long lists (Staff page with many accounts, users / customers exports) are done in batches (`memberIds`, `inBatches`) — before, a too-long request URL left them empty.

## Orders use the account's details; rating feedback everywhere (requested 2026-11-22)

Migration **0055**. SQL 99zzw extended; browser checkout/printing/telegram/exports-tickets updated (`fillIfEditable` test helper).
- **Name and phone come from the account** for every order and printing request (`accountContact`, src/lib/account/contact.ts): the server ignores the browser's values; only a value the account does not have yet is taken from the form and saved once (then locked). Checkout and printing forms show them read-only with a note.
- **Rating feedback**: `customer_rate_ticket` records stars + feedback in the activity log and sends `support_rating` (⭐ n/5 + feedback, User ID, who handled it) to the support Telegram group; the admin tickets list shows the feedback under the stars; Excel column "Rating feedback".

## Sign in on home, ticket rating / 24 h / 48 h, 30-minute orders, Excel exports page (requested 2026-11-22)

Migration **0054**. SQL `99zzw_*` (+98 export kinds); browser `test:smoke:exports-tickets` (new, 14); storefront/admin/help/reports updated. Full run: all 38 suites pass (idle-signout only flaky inside a full run, passes alone).
- **Home**: signed-out visitors see "Sign in" and "Create account".
- **Tickets**: customers see a closed ticket for 24 h after closing (RLS on tickets + messages; reply/rate refused after); `close_stale_tickets()` closes tickets waiting 48 h for the customer (system message + customer email) — called when the customer or admin support pages open and by the daily expire-orders cron. **Rating** 1–5 + comment (`customer_rate_ticket`, once, resolved/closed only): pop-up `RatePrompt` in the shop layout (dismissed per device via localStorage) and a rating box on the ticket page; admin list shows stars + average; detail shows the comment.
- **Orders**: `payment_window_minutes` (default 30, Settings → Delivery "Payment window (minutes)") sets `payment_due_at` on insert (`orders_payment_window`); `create_order_for_user` runs `expire_unpaid_orders()` first, so stock of overdue unpaid orders goes to the next buyer. A basket never holds stock; `useCartDetails` removes sold-out / withdrawn products from the basket (and lowers quantities) with a notice on cart + checkout. Help texts use {minutes}.
- **Excel exports** (`/admin/exports`, menu item for anyone with an export permission): orders, payments (+top-ups), customers, products & stock, wallet (balances + top-ups), printing jobs, support tickets (with ratings), activity, notifications, signed-in users, everything. New kinds via `/admin/exports/download?kind=…` (support/customers/products/wallet/printing), recorded (`admin_log_export`) and copied to the receipts Telegram group. Support tickets page also has an Excel button. **Clear closed tickets** (`admin_clear_tickets`, support.manage) only within 30 minutes after exporting the same dates; activity and notifications clearing linked from the page.

## Rejected payment cancels the order, User IDs only in lists, users Excel, installs fix (requested 2026-11-22)

Migration **0053**. SQL tests 20 + 96 rewritten for the new rejection rule; browser support-sessions (25), checkout, admin, account, customers, member-id, search-permissions updated.
- **Rejected payment → order cancelled automatically** (`orders_cancel_on_rejection`: stock released, printing jobs cancelled → documents deleted after their Telegram copy). Customer gets ONE message (`customer_order_payment_rejected`, now "payment not verified — order cancelled"; `email_order_event` skips the following "cancelled"). Orders already in payment_rejected were cancelled by the migration. Order page shows the reason; resubmission no longer exists. Legal/help texts updated.
- **User ID only in lists** (`UserIdLink`, src/components/admin/user-id.tsx → `/admin/users/[memberId]`): Customers, Staff team / deleted / personal permissions, Signed-in users (all tabs), Support tickets, Activity log (who + account items), Wallet balances & top-up detail, Stalled checkouts (`memberIds()` helper). `/admin/users/[memberId]` (`admin_find_user`): customer → redirects to the customer page; staff → details + `SignInPanel` (last sign-in, signed in now + Sign out, app devices). Customer page header is now "User ID …" with the sign-in panel.
- **Excel export of users** (`/admin/users/export?tab=now|last|installs` + the page filters): User ID, name, email, phone, staff/customer, role, sex, date of birth + per-tab columns (signed in/last active/IP/device; last sign-in/created/now; device/first/last opened/opens). Recorded (`admin_log_export('users')`) and copied to the receipts Telegram group.
- **App installs fix**: the device is remembered only after the server confirms (`recordAppOpen` returns ok) — before, an open during the deploy-before-migration window was lost for the day; also counted when opened from the app icon (`?source=app`) or any app display mode.

## User ID (6 digits), signed-in users, app installs, printing on payment, Support tickets (requested 2026-11-22)

Migration **0052**. SQL `99zzv_*` (+ 30/99zzk/99zzp/99zzu updated; test stub auth.sessions gains not_after/refreshed_at/user_agent/ip); browser `test:smoke:support-sessions` (new, 22), member-id, printing, telegram, telegram-feed, profile-activity updated. Full run 37/37 (idle-signout flaky in full runs, passes alone).
- **User ID**: `member_id` is now 6 digits (100000–999999), labelled "User ID" everywhere. Activity log shows "User ID" of who did it and "Customer User ID" of whom it concerns (`private.subject_user`: order / payment / printing job / top-up / ticket / account); a 6-digit search lists everything by or about that person; also in the Excel export.
- **Signed-in users** (`/admin/users`, security.manage): Signed in now (`admin_signed_in_users`, from auth.sessions, with device) + **Sign out** (`admin_sign_out_user` deletes their sessions → tokens die at once via `session_alive`); Last sign-in for every account with From/To or "not signed in since" (`admin_last_sign_ins`).
- **App installs** (same page, customers.view): `app_installs` (device, account, platform, first/last opened, opens). `AppOpenPing` (shop + admin layouts) calls `recordAppOpen` once a day per device+account when running as the installed app or on `appinstalled`; server action validates + rate-limits, then `record_app_install` (service_role only).
- **Printing**: no staff alert for a new printing request (`printing_request` always filtered); documents go to the printing group when the payment is submitted (`stage: payment_submitted`) or paid by balance. Payment rejected on an order with printing → job + order cancelled (`orders_cancel_printing_on_rejection`), files due now (`printing_jobs_files_due_on_cancel`); `printing_files_due_for_deletion` waits until the Telegram copy is sent; `deleteDuePrintingFiles` (src/lib/printing/retention.ts) runs after every dispatchSoon and in the daily cron.
- **Support & feedback**: `/support` (signed-in only, profile menu): topic (order / payment / delivery need one of the customer's order numbers; printing / balance / product may give one; other needs a title), details 10–3000; My tickets; `/support/[id]` conversation + reply. Tables `support_tickets`, `support_ticket_messages` (RLS: own tickets, no internal notes; staff with support.view). RPCs `customer_create_ticket`, `customer_reply_ticket`, `admin_update_ticket`, `admin_support_tickets`. Admin `/admin/support` (tabs per status with counts, search incl. User ID, dates) and `/admin/support/[id]` (reply / internal note / status / assignee); red menu count of open tickets. Customer gets email + push (`customer_ticket_update`). Permissions support.view / support.manage (Super Admin + Manager by default). Telegram **support** group: `TELEGRAM_SUPPORT_BOT_TOKEN` / `TELEGRAM_SUPPORT_CHAT_ID` (Notifications → Support group test button).

## Member ID, sign-in for Track order, footer hidden for signed-in / app (requested 2026-11-21)

Migration **0051**. SQL `99zzu_*`; browser `test:smoke:member-id` (new, 8), checkout + account + storefront updated. Full browser run: 36/36 suites pass.
- **Member ID**: `customer_accounts.member_id` (unique, 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`: no 0/O/1/I/L), for every account incl. staff; `private.new_member_id()`; trigger `customer_accounts_member_id` always generates it on insert and keeps it unchanged on update. Shown on My account, admin Customers list (searchable: `admin_customer_accounts` matches `member_id = upper(q)`), customer page header, Staff list. `getCustomerAccount` falls back if 0051 is not applied yet.
- **Track order needs sign-in**: page `requireCustomer`, in proxy SESSION_PATHS; action uses the customer's own session + `user_id` filter, order number only (no tracking code); rate-limited per account and IP. The tracking code is no longer shown after checkout (still generated/stored).
- **Footer**: Help / Contact grid hidden for signed-in customers and inside the installed app (`app:` variant = display-mode standalone).

## Search with dates, Excel copies to Telegram, permission sets (requested 2026-11-21)

Migration **0050**. SQL `99zzt_*`; unit (custom role keys); browser `test:smoke:search-permissions` (new, 9), telegram-feed (+ export copy).
- **Search with dates** (text + From / To, Warsaw days): Security → All events / Admin sign-ins (`admin_security_events(..., p_from, p_to, p_search)`, up to 1000), Notifications → Messages (`admin_notifications_search`, keeps the category sub-tabs), Activity log (`admin_activity_by_category(..., p_from, p_to)`, paging keeps the filters).
- **Excel exports → receipts Telegram group**: `sendExportCopy` (src/lib/telegram/export-copy.ts) sends the same .xlsx as a document after the response, from every export route (orders, payments, activity, notifications, sales report, full export); skipped when the receipts bot is not set up; never blocks the download.
- **Permission sets**: Staff → Permission sets: edit Manager / Staff / custom sets (name, description, permissions grouped by area), create new sets, delete unused custom ones (`admin_save_role`, `admin_delete_role`; `admin_roles.is_builtin`). Super Admin set always has everything. Team role pickers and Add staff use the sets from the database; context carries `role_name`.
- **Personal permissions**: Staff → Personal permissions: extra permissions for one person on top of their set (`profile_permissions`, `admin_set_member_permissions`, audited); `private.has_permission` and `my_admin_context` include them. "Manage staff" (staff.manage) can't be given to a set or a person (Super Admin only).

## In-store sales, clearing with an export first, clearing the reviewed list (requested 2026-11-21)

Migration **0049**. SQL `99zzs_*`; unit sales-report label; browser `test:smoke:instore-clear` (new, 11).
- **In-store sales** (Admin → In-store sales, orders.manage): counter form (products × quantity at today's price, optional discount, customer name / phone, note; paid by cash / mobile money / bank transfer) → `admin_create_instore_sale` (idempotent key): an order with `channel = 'in_store'`, paid + completed at once, `user_id` null (allowed for in-store), stock taken (`order_reserved` movements, so voiding releases it), walk-in customer `+251900000000`. Paused online services do not block the counter. "Void" → `admin_void_instore_sale` (stock back, refunded). Orders list marks them "In store"; dashboard / analytics count them as paid orders; sales report (`admin_sales_report`) shows in-store money by method and counts it in "Money in"; online bank totals exclude it.
- **Clear after export**: activity log (`admin_clear_audit_range`, any Warsaw days, audit.manage) and notifications (`admin_clear_notifications`, settings.manage, keeps waiting messages; new export `/admin/notifications/export` + `admin_notifications_export`) only when the same admin exported at least those days ("All areas") in the last 30 minutes (`private.exported_recently`). Clearing and export records are kept.
- **Recently reviewed**: "Clear" per entry and "Clear list" (`admin_clear_reviewed_list`, security.manage) hide entries (`security_reviews.hidden_at`); the review stays in force. Re-reviewing shows it again.

## Manage services, simpler footer, security alerts, Create account on the home page (requested 2026-11-21)

Migration **0048**. SQL `99zzr_*` (+ public settings count 9); browser `test:smoke:services` (new), security (blocked message).
- **Manage services** (Admin → Manage services, settings.manage): switches for Online shop (products), Printing, Wallet, Product reviews, New accounts + an optional customer message (EN / AM). Stored in public setting `services`; `private.service_on()`; triggers refuse: product / printing order lines, receipts for orders with a paused service, new printing jobs, top-ups, paying with balance (insert or switch to wallet), new reviews. Sign-ups paused in the app. Customers see "temporarily unavailable" (`ServiceNotice`) on shop / product / cart / checkout / printing / printing job / wallet / sign-up / review pages; Add to basket replaced. Delivery / pickup keep their switches (Settings → Delivery). Error code `service_unavailable`.
- **Footer**: no shop name / tagline / bank details / Shop links / Track order / Contact link. Help (Help, About, Privacy, Terms) and the shop's contact details side by side (2 columns also on phones), social buttons, install app, ©.
- **Home**: "Create account" button in the hero for signed-out visitors (hidden while sign-ups are paused).
- **Security**: an active alert = any suspicious email (score > 0: a failed sign-in, wrong code, rate limit …) not blocked / reviewed, plus suspicious customers (`src/lib/admin/security-alerts.ts`; badge, Active alerts, red rows with "active alert" / "high risk"). Tabs show red counts (`SubTab.alert`). Blocked emails: customer and admin sign-in / sign-up refused with "You're not allowed …", no event, no Telegram alert.

## My orders page, date of birth & sex, idle sign-out fix, home without sub-category list (requested 2026-11-21)

Migration **0047**. SQL `99zzq_*`; unit `age.test.ts`; browser: idle-signout (+ reopened after 5 hours), storefront (Cosmetics → sub-categories).
- **Home**: the sub-category chips are gone; Cosmetics / Electronics / Printing tiles open the section, which lists its sub-categories.
- **My account = menu**: balance card on top, then tappable lines (each its own page): Personal details `/account/details`, My orders `/account/orders`, Phone notifications `/account/notifications` (when push is set up), My offers `/account/offers` (only when the customer has codes).
- **My orders**: My account shows a "My orders" card (count + "Show orders") → `/account/orders`: one tappable line per order (and printing job) → order page. Unpaid orders that expired or were cancelled are not listed; opening the page first closes overdue unpaid orders (`expire_unpaid_orders`, rate limited per customer; the daily cron does the rest).
- **Date of birth & sex**: `customer_accounts` / `profiles` (`date_of_birth`, `sex` female / male). Customers: optional at sign-up (metadata → `handle_new_user`), or once on My account, then locked like name / phone (10+ years). Staff edit them: customer Details → Change personal details; Staff → Personal details tab (`admin_update_staff_details`, Super Admin, 14+ years). Shown as "Female · 29 years".
- **Idle sign-out bug**: reopening the app after hours counted as activity (the page start / first tap refreshed the time) and the activity cookie expired after 24 h. Now: an expired period on load, tap, focus or page show signs out; activity / session cookies kept 30 days.

## Warsaw time, Gmail-only sign-ups, printing documents group, customers cancel unpaid orders (requested 2026-11-21)

Migration **0046**. SQL `99zzp_*`; unit tests for Warsaw time (winter / summer / switch day) and the printing message; browser: telegram-feed (printing bot), account (Gmail only), profile-activity (customer cancel).
- **Time = Europe/Warsaw** everywhere (summer time included): `src/lib/datetime.ts` (`APP_TIME_ZONE`, `zoneToday`, `zoneDayStartIso`, `wallClock`, `zoneStamp`, `toZoneInput` / `fromZoneInput`), next-intl time zone, emails, Telegram ("(Warsaw time)"), Excel (wall clock), date filters, and the SQL day boundaries of `admin_dashboard_stats`, `admin_analytics`, `admin_sales_report`, `feed_security_event`. Country stays Ethiopia (ETB, +251 phones, addresses).
- **Gmail only for new accounts**: `refuse_other_email_domains` trigger on auth.users (setting `signup_email_domains`, default gmail.com); sign-up form shows the rule and a clear error; admin invitations and new staff refused with a message. Existing accounts unaffected. Local seed allows the test domains (never run seed in production).
- **Printing group** (`TELEGRAM_PRINTING_BOT_TOKEN` / `TELEGRAM_PRINTING_CHAT_ID`): when a printing job moves to "printing" (payment approved, or paid with balance), each document is queued (`printing_document`, bucket printing-files) and sent as a file with its original name, print options, customer and hand-over. Nothing for unpaid jobs. Test button + "Printing documents" category on Notifications. Not set up → dropped after 2 days.
- **Customer cancels**: `customer_cancel_order` (owner only; awaiting payment / receipt waiting / rejected; not after approval): releases stock, cancels linked printing jobs, closes a waiting receipt ("Order cancelled by the customer"), recorded (`by: customer`). "Cancel order" (with optional reason) on the customer's order page.

## Admin tabs & scroll frames, paid-only orders and payment-only alerts, locked customer details (requested 2026-11-21)

Migration **0045**. SQL `99zzo_*` (+ older Telegram tests lift the filter per file to keep checking message contents; dashboard test counts paid orders).
- **Admin layout**: `SubTabs` (ui.tsx) — sub-sections left to right, pinned under the top bar (`sticky top-16`), links `?tab=` (level 2 = in-page category row). `Panel scroll` and `Frame` (fixed height, own scroll, optional search) for long content. Applied to: customer detail (Details · Orders · Activity · Wallet · Promo codes · Manage), notifications (Messages with category sub-tabs · Telegram groups & alerts · Customer emails & phone · Receipt archive), order detail (Items · Payment · History & notes; opens on Payment when a receipt waits), promotions (Promotions · New · Banners · New banner), staff (Team · Add · Roles · Deleted), inventory (All · Low · Recent movements), stalled checkouts (3 lists), analytics (Trends · Categories & status · Best sellers · Inventory & promos), product edit (Details · Images · Visibility; opens on Images after create), settings (Business · Contact & hours · Social media · …), plus wallet / payments / printing / security / reviews using the same tab bar. Sidebar and top bar stay in place.
- **Orders = paid**: admin Orders list shows orders with a receipt waiting for approval, verified or refunded (searching by number / phone still finds unpaid ones). Dashboard "Paid orders", recent orders and staff counts the same (`admin_dashboard_stats`); "Awaiting payment" card removed (Stalled checkouts has them). Printing: Needs action · Payment to approve · Completed (unpaid jobs not listed).
- **Telegram orders group = payments only** (`private.telegram_filter`): receipts / resubmissions / top-ups waiting for approval, payment verified, paid with balance, printing requests to quote (switch). Never: order placed / steps / cancelled / payment rejected / printing steps / copies of customer messages. Switches for those removed from the page.
- **Customer details locked**: `customer_details_lock` trigger keeps name and phone once set (customers can still add a missing one, and change delivery city / address); `refuse_self_email_change` on auth.users refuses email-change requests. Staff edit name / phone / email in Admin → Customers → Details → "Change personal details" (`updateCustomerDetails`: email via Auth admin API after the permission check, then `admin_update_customer_details` records old → new in the activity log).

## Ethiopia time labels, one-at-a-time security reviews, one device per account, push to the latest account (requested 2026-11-21) — verified

Migration **0044**. SQL `99zzn_*` (stub now has `auth.sessions`); browser suite `test:smoke:single-session` (10); security-review suite updated.
- **Time**: everything already used Ethiopia's time zone (Africa/Addis_Ababa, UTC+3). Labels now say "Ethiopia" — Telegram alerts and the receipt archive "(Ethiopia)", admin pages / Excel "Ethiopia time".
- **Security alerts**: no "Mark all as reviewed"; each email / customer alert is reviewed on its own (database refuses more than one per call).
- **One device per account**: after a completed sign-in (customer password; staff only after the two-step code; email confirmation link) the app calls Supabase sign-out "others", which deletes the account's other sessions. `private.session_alive()` (token's `session_id` must still be in `auth.sessions`) is part of `private.mfa_verified()` (so every staff permission) and `private.is_active_customer()`, so an ended session's still-valid token can do nothing. The proxy asks `session_is_current()` on session pages and sends the old browser to the login page with "signed in on another device" (`reason=elsewhere`).
- **Phone notifications**: a device belongs to the account that signed in on it most recently. `claim_push_device` (security definer) moves the device from any other account; after a customer sign-in the `abiye_push_claim` cookie makes `PushClaim` (shop layout) re-register an existing subscription for the new account. Signing out does not stop notifications (customers are often signed out by the 20-minute timer while waiting for their order).

## Shop: For women / men, profile menu, categories on the home page (requested 2026-11-21) — verified

Migration **0043** (`products.audience`: women / men / unisex, optional; anon can read it). SQL `99zzm_*`; storefront suite +9 checks.
- Admin product form: "For (optional)" — Everyone / Women / Men / Unisex.
- Shop lists (`/shop`, `/cosmetics`, `/electronics`): "For: Everyone · Women · Men" chips (`?for=`), shown when products in that list have it; unisex appears under both. Product cards show "For women / For men / Unisex"; product page shows "For".
- Header: no ☰ side menu any more. Top bar: logo, **Home** and **Shop** (Cosmetics / Electronics / Printing join them on wide screens; on phones they are on the home page), profile icon, basket. The profile icon opens My account, Track order, About, Contact, Help and the language switch.
- Home: "Shop by Category" moved right under the hero — compact Cosmetics / Electronics / Printing tiles plus one-tap sub-category chips (Perfumes, Smartphones …) linking to `/<department>?category=<slug>`. Hero shorter on phones.

## Payments & top-ups open one at a time; Super Admin deactivates / deletes staff (requested 2026-11-21) — verified

Migration **0042**. SQL `99zzl_staff_remove_test.sql`; browser suites admin (59), wallet (22), archive-pickup, printing, telegram, emails, payments-export updated for the new flow.
- **Payments and Wallet lists show only the number** (order number / top-up number), when it was sent, and either "Check carefully" (reused reference or receipt, changed total) or the decision. Clicking opens `/admin/payments/[id]` or `/admin/wallet/[id]` with the receipt, all details and Verify / Reject. Receipt links (5-minute signed URLs) are created only on the detail page. Lists hold up to 200 and are searchable.
- **Staff page**: Role column (change + Save), Access column with **Deactivate / Reactivate** (confirm; reversible), **Delete** column (confirm; permanent). Delete = `admin_remove_staff`: no access, `removed_at` / `removed_by` set, cannot be switched back on (`admin_set_staff_role` refuses), open orders / printing jobs unassigned, never the last active Super Admin, not yourself; recorded by the profiles audit trigger (activity log + Telegram admin feed). Then the server action blocks their sign-in (Auth ban). The profile row stays so history shows names; listed under "Deleted staff". Their email cannot be reused for a new account.

## Approvals-only orders group, stock & receipts bots, inactivity sign-out, long lists (requested 2026-11-21) — verified

Migration **0041**. Browser suites `test:smoke:telegram-feed` (23, four mock bots), `test:smoke:idle-signout` (11), `test:smoke:long-lists` (6); SQL `99zzk_*` (+ older Telegram tests switch order progress on explicitly).
- **Orders & payments group: approvals only by default** — receipts uploaded / resubmitted, top-ups to verify, printing requests to quote (switch). Order & printing progress, payment decisions, cancellations, balance payments: switch `order_progress` (off). Copies of customer messages: switch (now off). Filtering happens before queueing (`private.telegram_filter` trigger).
- **Stock group** `TELEGRAM_STOCK_BOT_TOKEN` / `TELEGRAM_STOCK_CHAT_ID`: low stock / sold out; staff stock emails removed (they went to every active staff member whose role manages inventory). Until set, stock alerts use the orders bot.
- **Receipts group** `TELEGRAM_RECEIPTS_BOT_TOKEN` / `TELEGRAM_RECEIPTS_CHAT_ID`: every verified / rejected receipt (file attached, with order/top-up, amount, reference, bank account, customer, decided by, reason) in addition to the email archive (`receipt_record`, queued with the decision). Routing `private.telegram_group`, claiming `claim_telegram_groups`. Test buttons per group (`admin_queue_group_test`).
- **Inactivity sign-out**: admin 8 min, customers 20 min (`src/lib/security/idle.ts`). Browser timer (`IdleSignOut`, real input only — programmatic scroll events ignored; shared across tabs through the `abiye_active` cookie; warning 1 min before with "Stay signed in") + proxy check on session pages (`abiye_sid` httpOnly cookie binds the activity time to the Supabase session id; new sign-in starts fresh). Login pages explain the sign-out; customers return to the page.
- **Long admin lists**: `Table scroll` → box of max 65% screen height scrolling on its own with sticky column titles + search filter ("x of y shown") on activity, customers, follow-up, inventory, notifications, orders, printing, products, security, wallet; stock movements list too (`Searchable`).

## Delivery asked once; no empty city list (reported 2026-11-21) — verified

- Basket no longer has its own delivery / city picker (it showed the choice twice and blocked "Proceed" until a city was picked). It shows the items total and "Delivery or pickup is chosen at checkout" (+ free-delivery threshold hint).
- Home delivery is offered (checkout, printing form) only when delivery is switched on **and** at least one delivery city is active; otherwise pickup only, pre-selected (`deliveryEnabled = delivery_enabled && zones.length > 0`).
- Owner action: add delivery cities in Admin → Settings → Delivery (production had none active).
- Tests updated: storefront (+ no-cities / with-cities checkout checks), printing (chooses pickup at checkout; cancels leftovers of interrupted runs). `scripts/dev-up.sh` now treats a docker/containerd pid file as stale unless that PID really is dockerd/containerd (PIDs are reused after a restart).

## Staff not listed under Customers (requested 2026-11-21) — verified

Migration **0040**: `admin_customer_accounts` excludes staff (profiles) everywhere (list, search, detail, wallet lookup); `is_staff` kept (always false). `admin_is_staff_account` lets `/admin/customers/<staff id>` redirect to `/admin/staff`. Customers page says staff are managed under Staff. SQL `99zzj_*`; customers browser suite updated (31). Also fixed a time-of-day flake in the analytics SQL test (used the UTC date; now Addis date).

## Personal discount codes sent to the customer (requested 2026-11-20) — verified

Migration **0039**. `npm run test:smoke:promo-send` (7; own app on :3106 with mock Resend), SQL `99zzi_*`, unit email case.
- Customer page → Personal promo codes → **Create & send a new code**: % (≤ 90) or ETB off, optional minimum order, valid 1–365 days, optional personal message, "Send it to the customer" (default on). `admin_create_personal_code` makes a unique `FIRSTNAME-XXXX` code (no 0/O/1/I), restricted to that customer, once, then assigns and notifies. Confirmed active customers only (not staff).
- Giving an existing personal promotion (customer page or Promotions page) now also sends it, with the same tick box and message (`admin_assign_promotion(..., p_notify, p_note)`; never sent twice).
- Message `customer_promo_gift`: bilingual email with the code, discount, minimum, expiry and note; phone notification opens My account → My offers (`/account#offers`). Sent immediately (`dispatchSoon`), and copied to the orders Telegram group (shows the code).

## Two Telegram groups, categories, security alerts dashboard (requested 2026-11-20) — verified

Migrations **0037** (two groups + order/printing progress + notifications channel) and **0038** (activity categories). Browser suites `test:smoke:telegram-feed` (17, two mock bots), `test:smoke:activity-categories` (8), `test:smoke:security-review` (17); SQL `99zzg_*`, `99zzh_*`.
- **Telegram groups**: orders & payments group = `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID`; **security group** = `TELEGRAM_SECURITY_BOT_TOKEN` / `TELEGRAM_SECURITY_CHAT_ID` (optional; until set, security messages wait 24 h then are dropped). Routing by event (`private.is_security_message`: security_event, security_alert, admin_action, security_test); sender claims each group separately (`claim_telegram(p_security)`; `dispatchGroup`). Per-group test buttons.
- **Orders group now follows each order to pickup**: `order_placed` (deferred constraint trigger: only if still awaiting payment at commit, so balance-paid orders are not doubled), `order_status` (processing, ready for pickup, out for delivery, completed, expired — with who did it and note), `printing_status` (quoted, printing, ready, completed, cancelled); plus existing receipt-to-verify, verified/rejected, cancelled, wallet, stock, customer-message copies.
- **Notifications page**: both groups + feed switches; all messages grouped in expandable categories (Orders & printing, Payments & wallet, Stock, Security & admin, Customer messages; failed ones open automatically; "skipped" = expired feed messages, not counted as failures). `admin_notifications` now returns `channel`.
- **Activity log**: six clickable category cards with 30-day counts (Orders & printing, Payments & wallet, Customers, Products & catalog, Staff & settings, Security & data) via `private.activity_category`, `admin_activity_categories`, `admin_activity_by_category`; search stays inside the category.
- **Security → Active alerts** (default tab): high-risk emails (score ≥ 6, 7 days) and suspicious customers (30 days) not yet blocked / reviewed / deactivated, each with what happened and Block / Mark as reviewed (+ note); empty state when all actioned; "Recently reviewed" below. Old Overview = "Health & stats". Red Security badge = number of active alerts.

## Telegram activity feed (requested 2026-11-20) — verified

Migration **0036**. `npm run test:smoke:telegram-feed` (10 checks; own app on :3105 with mock Telegram + mock Resend), SQL `99zzf_*`, unit cases in `telegram-format.test.ts`.
- Every Telegram message now has a title line plus `Service: … · Event: …` (`describe()` in `src/lib/telegram/format.ts`), including the existing order/payment/printing/wallet/stock messages.
- **Security** (trigger on `security_events`): every event with what happened, email used, account (staff flag), network, device, details, Addis time. Same failure / email / network within 5 minutes → one message with "× N" (+ at most one follow-up); admin sign-ins always individual. **🚨 alert** once per email per day when its 24 h risk score (unreviewed, not blocked) reaches 6.
- **Admin actions** (trigger on `audit_logs`): email blocked/unblocked, alerts cleared, data reset, activity cleared, two-step reset, wallet corrections, customer deactivate/reactivate/delete, password reset sent, receipt-archive changes, all exports, and any change to staff, role permissions, bank accounts or settings — with who (role), item, details and before/after.
- **Notification copies** (trigger on `notifications_outbox` status → sent/dead for email, push, archive): channel, event, recipient, order/job/top-up, amount, attempts, error.
- Switches (Admin → Notifications → Telegram activity feed; `telegram_feed` private setting, Super Admin): security / admin actions / notification copies (default on). Sent right after the request (`telegramSoon()` in `requirePermission` and `recordSecurityEvent`; copies after each customer-message dispatch). Feed messages older than 24 h are skipped by the sender and purged after 2 days by the daily maintenance, so nothing floods in when Telegram is connected later.

## Clearing security alerts (requested 2026-11-20) — verified

Migration **0035**. `npm run test:smoke:security-review` (9), SQL `99zze_*`.
- `security_reviews` (RLS, no direct access): `admin_mark_security_reviewed(type, subjects, note)` (`security.manage`, Super Admin; audited `security_reviewed`). `admin_suspicious_emails` / `admin_suspicious_customers` now count only activity **after** the last review, so a reviewed email/customer leaves the lists and the red badge and returns only on new activity; events are kept. Security page: "Mark as reviewed" per row, "Mark all N as reviewed" (optional note), "Recently reviewed"; the Overview "Failed admin sign-ins" card colour follows unreviewed attempts ("all reviewed").

## Export everything + reset test data (requested 2026-11-20) — verified

Migration **0034**. `npm run test:smoke:export-reset` (18 checks; WIPES local orders/customers — runs last), SQL `99zzd_*`, unit `data-export.test.ts`.
Owner choices: reset = clear test data before launch; export = one Excel workbook; strict safeguards.

- New permission `data.manage` (Super Admin only). Admin → **Export & reset**.
- **Export everything**: `/admin/data/export` → About + 29 sheets (orders, items, payments, history, notes, printing jobs/files, customer accounts + email, customers, addresses, wallet top-ups/ledger, reviews, back-in-stock requests, products, images, categories, inventory, promotions, personal codes, zones, banks, printing prices, banners, settings, staff, activity log, security events, blocked emails) via `admin_data_export(area, offset, limit)` (allow-listed; token hashes / idempotency keys / push keys never exported; files not included). Recorded (`export_all`).
- **Reset test data** `admin_reset_test_data(phrase)`: refused unless the phrase is exactly `RESET <English business name>` AND the same admin exported everything in the last 30 minutes (DB-checked); the app also requires a fresh authenticator code (failed codes are security events) and a tick box + confirm dialog. Deletes orders (+items/payments/history/notes), printing jobs (+files), customers, customer sign-in accounts (non-staff `auth.users`), wallet top-ups + ledger, reviews, back-in-stock requests, saved baskets, push subscriptions, outbox, rate limits, security events, activity log (except `audit_cleared` / `data_reset`); inventory movements linked to orders (stock levels kept). Order / printing / top-up numbers restart (ET-10001, …). Keeps products, categories, promotions, banners, settings, banks, zones, prices, staff (+2FA), blocked emails. Append-only guards are bypassed only inside the function (transaction-local flags) and the `data_reset` record can never be deleted. Afterwards the server removes the now-unreferenced receipts / printing documents from Storage (`reset_storage_leftovers`, service role).
- Gotcha found by the browser test: hosted Supabase rejects `DELETE` without `WHERE` on API calls (pg_safeupdate, SQLSTATE 21000) → bulk deletes use `where true`; customer activity entries are removed before the accounts (their `actor_id` would otherwise need an update, which the append-only log refuses).

## Safety net, stock alerts, reviews, sales reports (requested 2026-11-20) — verified

Migrations **0031–0033**. Browser suites `test:smoke:stock-alerts` (14), `test:smoke:reviews` (17), `test:smoke:reports` (14); SQL `99zza_*`, `99zzb_*`, `99zzc_*`; unit `sales-report.test.ts`, email template cases.

- **CI** (`.github/workflows/ci.yml`): every push / pull request runs lint, typecheck (`next typegen && tsc`), unit tests, production build (placeholder public env, no secrets) and the SQL suite twice (migrations, then production bundle). **Dependabot** (`.github/dependabot.yml`): weekly npm updates (minor+patch grouped), monthly Actions updates; each opens a pull request checked by CI — merge in GitHub only when CI is green. The repository was renamed to `Fikireyesusba/abiye` (old URL redirects).
- **Stock alerts (0031)**: trigger on `products.stock_quantity/status` → Telegram `low_stock` / `out_of_stock` + English staff email (`staff_low_stock` / `staff_out_of_stock`) to active staff whose role has `inventory.manage`, once per crossing. `stock_alerts` (RLS: own rows; stock managers read all) via `request_stock_alert` / `cancel_stock_alert` (confirmed active non-staff customers, product must be sold out, ≤ 50 open). Restock 0 → >0 sends `customer_back_in_stock` email (+ push if subscribed) once per request. Product page: "Notify me when available" (client component; page stays cacheable). Inventory: "N customers waiting"; red badge = active products at/below their level (`admin_low_stock_count`).
- **Reviews (0032)**: `product_reviews` (public: approved rows, safe columns only — no user/order), `submit_product_review` only with a **completed** order containing the product; edits/updates return to pending; `delete_my_product_review`; `admin_product_reviews` / `admin_moderate_review` (new permission `reviews.manage`: Super Admin + Manager; audited). `products.rating_avg/rating_count` maintained by trigger from approved reviews. Shop: stars on cards and product page, reviews list ("Verified purchase", first name + initial), JSON-LD aggregateRating, review box with status/rejection reason, "Write a review" on completed orders. Ratings/reviews are read separately and tolerate a missing migration (shop keeps working before 0032 is applied). Admin → Reviews (To approve / Published / Rejected), badge.
- **Sales reports (0033)**: `admin_sales_report(from, to)` (`analytics.view`, Super Admin; ≤ 1 year): money counted on the payment **verification** day (Addis); totals (orders placed/paid, sales split products/printing/delivery/discounts, paid by bank vs balance, top-ups, money into the bank, cancelled after payment + refunds), by bank account, by day, verified by staff, top products, cancelled-after-payment list. Admin → **Sales reports**: Daily closing / Monthly statement, Print (admin chrome hidden in print), Excel (6 sheets; `export_sales` audited).

## Printing documents deleted at pickup + payment receipt archive (requested 2026-11-20) — verified

Migration **0030**. `npm run test:smoke:archive-pickup` (20 browser checks, own app on :3104 with a mock Resend), SQL `99zz_*`, unit `receipt-archive.test.ts`.

- **Pickup clean-up**: "Mark collected / delivered (deletes documents)" (confirm) → the job's files are removed from storage immediately and recorded (`printing_files_deleted`, audited); the job record stays. A DB trigger sets `files_delete_after = now()` when a job becomes `completed`, so the daily storage maintenance removes them if the immediate delete fails (`printing_files_due_for_deletion` now inclusive). Migration also marks earlier completed jobs due. Customer job page: "Your files have been deleted from our system"; help/privacy wording updated. Retention days remain the upper limit for jobs never completed.
- **Receipt archive** (owner choice: email, on decision): Admin → Notifications → *Payment receipt archive* (Super Admin, `settings.manage`): archive address (private setting `receipt_archive`, `admin_set_receipt_archive`, audited; the previous address is emailed when it changes), Send test email, status (archived / waiting / failed, last error), **Send past receipts** (date range; dedupe = never twice). Triggers on `payment_submissions` / `wallet_topups` queue an outbox row (channel `archive`, 20 attempts, never dropped for age) when a receipt is verified or rejected; `src/lib/email/archive.ts` downloads the receipt from private storage and emails it as an attachment via Resend with result, order/top-up, amount, bank + account, reference, customer, uploaded/decided time (Addis), decided by, reason, SHA-256. Sent immediately after the decision; retried by the notifications cron. Retry button on Notifications now re-sends any channel.

## Payments export to Excel (requested 2026-11-20) — verified

Migration **0029**. `npm run test:smoke:payments-export` (14 browser checks), SQL `99z_*` (15 assertions), unit `payment-export.test.ts`, related suites green.

- **Payments → Export verified & rejected payments to Excel** (`payments.view`: Super Admin + Manager): period by **decision date** (Addis time, ≤ 1 year), Verified + rejected / Verified only / Rejected only, optional **wallet top-ups** sheet (only with `wallet.manage`). Pending payments are never included.
- Sheets: Summary (counts + amounts per result), Order payments (result, decided at/by, rejection reason, order + status, customer name/phone/email, amount expected vs order total, bank + account, bank reference, receipt file + upload time, warnings: reference/receipt reused on other orders, amount mismatch), Wallet top-ups.
- DB: `admin_payments_export`, `admin_topups_export` (SECURITY DEFINER, permission-checked, ≤ 50,000 rows; fetched in pages of 1,000); `admin_log_export('payments')` records each export (`export_payments`). 20 exports/hour per admin.

## Saved personal details + activity log export/clear (requested 2026-11-20) — verified

Migration **0028**. `npm run test:smoke:profile-activity` (17 browser checks), SQL `99y_*`, full regression green.

- **My account → Personal details**: shown read-only (name, email, phone, delivery city, address; "Not set" when empty) with a **Change personal details** button → edit form (Save / Cancel). New columns `customer_accounts.default_zone_id` / `default_address` (customer may update only these + name/phone). Checkout prefills name, phone, city and address from the account; a delivery order saves the latest city/address back. Changes appear on the customer timeline.
- **Activity log → Export to Excel** (`audit.view`): date range + area → `.xlsx` (Addis time, who, role, what, area, item, changes, details; ≤ 50,000 rows; 20 exports/hour); each export is itself logged (`export_activity`).
- **Activity log → Clear old entries** (new permission `audit.manage`, Super Admin only): removes entries **before** a chosen date; the last 30 days are always kept (DB-enforced), the admin must tick "I downloaded an Excel export", confirm dialog, and each clearing is recorded permanently (`audit_cleared`, never removable). Otherwise the log stays append-only (trigger allows deletes only inside `admin_clear_audit_logs`).

## Security & health monitoring (requested 2026-11-20) — verified

Migration **0027**. `npm run test:smoke:security` (20 browser checks), SQL `99x_*`, full regression (19 suites) green.

- `security_events` (email used, account, hashed network, device; passwords never stored; purged after 180 days by the maintenance job): admin sign-in failed / non-staff tried admin / wrong two-step code / admin signed in / customer sign-in failed / staff tried customer sign-in / blocked sign-in or sign-up / rate limited. Recorded from the sign-in, two-step, sign-up and password-reset actions (`src/lib/security/events.ts`, never throws).
- **Blocked emails** (owner's choice instead of alert messages): Super Admin (`security.manage`) blocks from the Security page; refused at sign-up (app + `auth.users` trigger for direct API sign-ups), sign-in (app; existing account deactivated + Supabase ban), password reset/confirmation emails (silently skipped) and ordering/top-ups (DB `email_blocked`). Staff emails are refused (manage under Staff). Unblock reactivates accounts that were deactivated by the block. Audited.
- **/admin/security** (`audit.view`, Super Admin): Overview (24 h counters, payments/top-ups waiting, out of stock, **site health**: email/phone/Telegram configuration, scheduled-job heartbeats from `cron_runs` (flag after 36 h), unpaid orders not expiring, paid orders waiting > 24 h, notification queues per channel), Suspicious emails (scored; admin attempts weigh more; networks counted; Block), Suspicious customers (repeated unpaid/expired orders, rejected receipts, receipts/references reused by another customer, many failed sign-ins, baskets + unpaid orders), Blocked (Unblock), Admin sign-ins, All events. Red badge = high-risk emails in the last 24 h not yet blocked.

## Wallet / shop credit (requested 2026-11-20) — verified

Migration **0026**. `npm run test:smoke:wallet` (21 browser checks), SQL `99w_*` (30+ assertions), full regression green. Owner decisions: max balance **10,000 ETB**; balance pays an order **only if it covers the whole total**; **no withdrawals** (shop credit; refunds of cancelled balance-paid orders go back to the balance). Regulatory note given to the owner (NBE stored-value rules — confirm with accountant/lawyer).

- DB: `customer_accounts.wallet_balance_etb` (≥ 0, not customer-writable), append-only `wallet_ledger` (balance_after per row), `wallet_topups` (receipt in `payment-receipts/topups/<user>/…`, content-checked, duplicate receipt/reference flagged), permissions `wallet.manage` (Super Admin + Manager: verify/reject) and `wallet.adjust` (Super Admin: corrections with reason). All money moves in `private.wallet_post` (row lock, never < 0). Limit counts pending top-ups; re-checked at verification. `create_order_for_user` with `payment_method='wallet'` pays atomically (insufficient → whole checkout rolled back; retry never charges twice); paid order confirmed instantly, "please pay" messages removed, staff Telegram `wallet_order_paid`. Cancel → `refund_wallet_order` trigger credits back, payment `refunded`. `storage_orphans` keeps top-up receipts.
- Customer: My account balance card; `/account/wallet` (balance, pending, limit, bank details, top-up form, requests with rejection reasons, history); checkout "How do you want to pay?" (balance option disabled when it does not cover the total); emails + phone notifications for verified/rejected top-ups; Help section.
- Admin: `/admin/wallet` (To verify with receipt preview + duplicate warning, Verified, Rejected, Balances with total owed); red badge; customer page "Wallet balance" panel (ledger + Super Admin correction); activity log entries.
- Fixes found by tests: amount over the limit now explains the limit instead of a silently disabled button; wallet admin looked up customer names among only the newest 500 accounts (now per customer on the page).

## Staff accounts are not customer accounts (requested 2026-11-20) — verified

Migration **0025**. `npm run test:smoke:staff-portal` (9), SQL `99_*`, full regression green.

- Customer sign-in refuses staff/admin logins (`staffAccount` message) and signs them out; a dashboard session is not a customer session (`getCustomerUser` → null), so no My account / checkout; the database refuses orders and printing jobs from staff (`staff_account`).
- **Fix found by the test:** with two-step login, Supabase requires `aal2` to change a password, so staff "forgot password" failed. The reset now sends staff to `/admin/mfa?next=/account/reset-password` first, then back to choose the password. Password reset pages accept any signed-in account (`getSignedInUserId`).

## Orders → Excel export (requested 2026-11-20) — verified

Migration **0024** (audit only; the export works without it). `npm run test:smoke:export` (13 checks: real download opened with exceljs and compared with the DB), unit test of the workbook, regression green.

- Admin → Orders → **Export to Excel** (`orders.view_all`: Super Admin, Manager): date range (Addis Ababa days, ≤ 1 year), all / paid (verified) only / one status → `GET /admin/orders/export` → `.xlsx` with **Summary** (period, counts, order value, verified revenue, delivery fees, discounts, by status), **Orders** (one row per order: number, placed, status, payment, customer, phone, delivery, city, address, items, subtotal, fee, discount, promo code, total, verified at, bank reference) and **Items** (one row per line). Real numbers (ETB format) and dates (Addis time), frozen header + filters, Amharic intact.
- Reads through the admin's session (RLS), rate limited (20/h), recorded in the Activity log (`admin_log_export`). `exceljs` added; `uuid` overridden to 11.1.1 (npm audit clean).

## Customer phone notifications — Web Push (requested 2026-11-19) — verified

Migration **0023**. Verified with `npm run test:smoke:push` (10 checks: own app on :3103, HTTPS mock push service; the test owns the device keys and **decrypts** the aes128gcm payload; SW shows it via CDP deliverPushMessage), SQL `97_*`, unit templates, full regression green.

- `push_subscriptions` (own rows via RLS; endpoints restricted to real push services — prevents server-side requests elsewhere; max 10 devices). Every customer event also queues an outbox row `channel='push'` (only if the customer has a device). `push_targets()` for the worker.
- `src/lib/push/` (`web-push`): short bilingual texts per device language, VAPID, TTL 1 day, 404/410 → device removed, 429/5xx retried, stale rows dropped. Sent with `dispatchSoon()` and by the crons.
- UI: `PushToggle` on My account and the order page (signed-in, order in progress); iPhone outside the installed app → install first; blocked/unsupported explained. Service worker shows notifications and opens the order on tap (`sw.js` v2).
- Optional integration settings (Telegram, Resend, VAPID) are trimmed (spaces/quotes) and, if invalid, switched off and reported instead of breaking the site (`optionalEnvProblems()`); the phone panel lists exactly which VAPID variable is missing/invalid.
- Admin → Notifications: status for customer emails + phone notifications; **VAPID key generator in the owner's browser** (WebCrypto; private key never leaves the browser). Config `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (DEPLOYMENT §10).

## Installable app — PWA for Android and iPhone (requested 2026-11-19) — verified

No migration. `npm run test:smoke:pwa` (15 checks: Chrome installability via CDP = no errors, service worker, offline page, iPhone flow), full regression green.

- `src/app/manifest.ts` (name/tagline from settings, refreshed hourly; standalone; theme #14523f; shortcuts Shop / Printing / My orders); icons in `public/icons/` generated by `scripts/generate-app-icons.cjs` (edit the SVG there to change the design; apple-touch-icon for iPhone).
- `public/sw.js`: pages always from the network (offline → `/offline`, bilingual, works without JS); only immutable `/_next/static` + icons cached (capped at 150 entries); nothing private cached. Served with no-cache + its own CSP; excluded from the proxy.
- `src/components/pwa/pwa.tsx`: service worker registration (production only), Android “Install app” (beforeinstallprompt), iPhone “Add to Home Screen” 3-step sheet, dismissible phone banner (hidden 14 days after “Not now”, never when already installed), install section on /help and in the footer.
- **App icon from the business's own images**: `/app-icon/[32|180|192|512|maskable-512]` (`next/og` ImageResponse) draws the uploaded square **App icon** (Admin → Settings → Business; PNG/JPG, stored as `business.app_icon_path`), else the logo centred on white, else redirects to the built-in `public/icons`. Used by the manifest, the iPhone icon, the browser tab (default favicon removed) and the install banner. Cached 1 h.
- Possible next steps: Google Play listing via PWABuilder (needs `/.well-known/assetlinks.json`), push notifications.

## Customer Help guide + email-link fixes (requested 2026-11-19) — verified

`npm run test:smoke:help` (9), account/checkout/printing/emails suites updated, full regression green; axe scan of /help (desktop EN + phone AM): 0 violations.

- **/help** "Help & how to order" (EN/AM, `src/content/help.ts`): what we offer, create account, shopping, checkout, paying by bank transfer + receipt, after payment (every order status with its badge), tracking, printing, offers/promo codes, cancellations/returns, FAQ. Live values from settings (payment window, file limits, retention, business name). Linked in header, footer, checkout ("How do I pay?") and the order page.
- Email links (order / printing job): signed-out visitors are sent to sign in and returned to the page; signed in with a **different** account → clear notice + "Sign in with another account" (`switchCustomerAccount`) instead of "Order not found".

## Customer email notifications (requested 2026-11-19) — verified

Migration **0022**. Verified with `npm run test:smoke:emails` (12 checks, own app on :3102 + mock Resend API), SQL `96_*`, unit tests for the templates, and every other suite re-run (all pass).

- Outbox channel `email` (`recipient_user_id`; address looked up only when sending). DB triggers queue: order placed (amount, bank details, deadline, receipt link), confirmed, payment rejected (reason), ready for pickup, out for delivery, completed, cancelled, expired; printing price ready, printing ready. `claim_outbox(channel)`; `claim_notifications` now takes Telegram rows only.
- `src/lib/email/templates.ts` (bilingual EN+AM, escaped) and `src/lib/email/dispatch.ts` (Resend API, idempotency key per outbox row, 429/5xx retried with backoff, other 4xx dead, rows older than 2 days dropped). Sent right after the request via `dispatchSoon()` (checkout, payment review, order status, printing quote/status) and by the notifications + expire-orders crons.
- Config: `RESEND_API_KEY`, `EMAIL_FROM` (optional; nothing sent without them). DEPLOYMENT §9.
- `db:types` safety check fixed (it rejected valid output).

## Two-step login for admins (requested 2026-11-19) — verified

Migration **0021**. Verified with `npm run test:smoke:mfa` (16 browser checks incl. direct database-API calls with a password-only token), SQL `95_*`, every other suite re-run (all pass; they now sign in through `tests/e2e/_admin.cjs`, which generates TOTP codes and keeps test secrets in the OS temp dir).

- Supabase Auth MFA (TOTP). Admin sign-in: password → `/admin/mfa` → 6-digit code; first time: QR code + manual key set-up. Mandatory for every admin role; customers unaffected.
- Enforced twice: app (`getAdminContext` requires JWT `aal2`, `requireAdmin` sends aal1 sessions to `/admin/mfa`) and database (`private.mfa_verified()` inside `has_permission` / `is_admin` / `current_role_key` / `my_admin_context`). `my_staff_status()` tells the sign-in flow it is a staff account before the second step.
- Code attempts rate limited (6 / 15 min per user, 30 per IP). Half-finished set-ups are removed before a new QR is issued.
- Staff page: "Two-step login" column (On / Not set up) and **Reset** (Super Admin, not self; removes factors via Auth admin API; audited `mfa_reset`). Owner recovery SQL in DEPLOYMENT §8.
- Local: `supabase/config.toml` enables TOTP (restart local Supabase after changing it). `dev-up` removes a stale docker pid after sandbox restarts; `db:types` no longer overwrites the types file when the database is down.

## Red "waiting for action" badges (requested 2026-11-19) — verified

No migration. Red count bubbles in the admin menu (`src/lib/admin/badges.ts`, `src/components/admin/admin-badges.tsx`), per role (RLS applies): **Payments** = receipts waiting for verification; **Orders** = paid orders waiting to be processed (staff: only assigned); **Printing** = jobs waiting for a quote or paid and waiting to print; **Notifications** = Telegram messages that failed permanently. Header shows a red "N payments to verify" link; on phones the menu button shows the total. Counts refresh every minute while the tab is visible, when the admin returns to the tab, and immediately after any admin action that reloads the page.

## Personal promo codes (requested 2026-11-19) — verified

Migration **0020**. Verified with `npm run test:smoke:personal-promo` (12 browser checks), SQL `90_*`, all other suites re-run (0 failures).

- Promotion option **"Only for selected customers"** (`promotions.restricted`, needs a code, never on the homepage — DB check). `promotion_customers` (RLS; added only via `admin_assign_promotion(p_promotion_id, p_emails[])`, removed by `promotions.manage`). `private.apply_promotion` refuses the code for anyone else (`invalid_promo_code`), so checkout and preview enforce it.
- Admin: give codes by email on the promotion (reports unknown/duplicate emails, list of holders with "used" + Remove), or from a customer's page ("Personal promo codes" panel). Giving/removing is audited on the customer (timeline + Activity log).
- Customer: **My account → My offers** (`my_offers()`): their usable personal codes with copy button, minimum, end date (EN/AM); used once-per-customer codes disappear.

## Phase 7 — finalization (verified)

Verified with `npm run test:smoke:phase7` (22 browser checks) plus every earlier suite re-run under the new CSP (storefront 40, checkout 37, admin 50, printing 37, account 51, customers 30, Telegram 31), SQL suites incl. `80_*`, 139 unit tests, an axe-core WCAG 2.1 AA scan of 25 pages × desktop/phone (0 violations), `npm audit --omit=dev` (0 vulnerabilities). Migration **0019**.

- **Promo codes work at checkout** (they were display-only before): customer enters a code, server-side preview (`quote_promotion`, rate limited), and `create_order` computes the discount itself (`private.apply_promotion`): scope all / category (incl. subcategories) / product, minimum order, optional usage limit, once per customer account, start/end, never makes an order free (≥ 1 ETB), printing not discounted. Discount shown on checkout, order page, admin order. Private codes are no longer readable via the public API (only homepage promotions).
- **/admin/promotions** (`promotions.manage`): promotions (create/edit/delete-if-unused, live/scheduled badges, usage counts) and **homepage banners** (image upload → server content check, internal links only, schedule, order, show/hide; old images removed).
- **/admin/analytics** (`analytics.view` or `reports.operational`): 7d / 30d / 90d / 12m or custom range, day/week/month buckets (Addis Ababa days), verified revenue & paid orders, orders placed, sales by category, best sellers, order status & delivery/pickup split, promo usage, inventory (low/out of stock, stock value). Money figures only with `analytics.view` (Super Admin).
- **Content-Security-Policy** with a per-request nonce on every page (`src/proxy.ts` + `src/lib/security/csp.ts`, unit tested; browser test asserts zero violations). Session refresh now only on session pages.
- **Abandoned uploads** (receipt/printing files uploaded but never submitted) are deleted daily by the storage-maintenance cron (`storage_orphans()`, older than 1 day).
- **Security review**: every public table has RLS; no `public` function executable by `anon`; every SECURITY DEFINER function pins `search_path`; anon has SELECT only on catalog/settings tables; every server action is guarded (permission / session / cron secret) and rate limited where public; admin `next` redirect validated; no secrets in git history; secret key only in server code.
- **Accessibility/mobile**: darker success/info/destructive colours (contrast), names for icon-only links, labelled admin form fields (shared `Field`), keyboard-scrollable tables, chart bars exposed to assistive tech, checkout summary markup, catalog heading order.
- Telegram browser suite now always stops its own app server (it could leave a stale server on :3101).
- Owner hand-off: **docs/GO-LIVE.md**.

## Customer account management (requested 2026-11-19) — verified

Verified with `npm run test:smoke:customers` (30 browser checks incl. real reset/invite emails), all other suites unchanged and passing, `supabase/db-tests/70_*` (SQL), 135 unit tests. Migration **0018**.

- **Admin → Customers → (customer)** "Manage account" panel (new permission `customers.manage`, Super Admin only by default): send password reset email; resend invitation (unconfirmed accounts); **deactivate** (reason required) / reactivate; **delete** (only accounts without orders or printing jobs — otherwise deactivate, order history is kept). Customers list: "Invite a customer" form, Deactivated badge. Staff accounts are refused (`cannot_manage_staff`) — they stay under Staff.
- **Deactivation is enforced 3 ways**: Supabase Auth ban (sign-in refused, mapped to a "deactivated" message); the app ignores an open session of a deactivated account (`getCustomerUser` checks `customer_accounts.deactivated_at`) and refuses sign-in; the database refuses orders/printing jobs (`account_deactivated`, also when only banned) and hides the customer's own data (RLS gated by `private.is_active_customer()`).
- **Per-customer activity timeline**: admin actions with who/why, the customer's own name/phone changes (audit trigger), Supabase Auth events (sign-up, sign-in/out, password reset/change; token refreshes hidden), orders, order status changes, payments submitted/verified/rejected, printing jobs. Plus a "Purchase history" table.
- **Activity log** `/admin/activity` (`audit.view`, Super Admin): every audited change system-wide (customer accounts, payments decisions, order status/assignments, staff/roles, bank accounts, settings, delivery zones, printing prices, products, promotions) with actor name/role, item link, field-by-field changes; filter by area, search, paging. Append-only.
- **Stalled checkouts** `/admin/follow-up` (`customers.view`; dashboard card "Stalled checkouts (2h+)"): unpaid orders (awaiting payment / payment rejected), priced-but-unpaid printing jobs, and **baskets of signed-in customers left without ordering** — 2h / 6h / 1 day / 3 days, with phone / WhatsApp / email. Baskets are saved per account (`customer_carts`, ids + quantities only, RLS own row) by a debounced `CartSync` in the shop layout; placing an order empties it. Guests' baskets are not tracked (not signed in).

## Browser-only deployment (owner preference, 2026-11-19)

The owner does not run anything from a personal computer. Production database setup is `supabase/production-setup.sql` (generated by `npm run db:bundle`: all migrations + category starter + migration bookkeeping, one transaction, refuses to re-run) pasted into the Supabase SQL Editor. Verified on a brand-new Supabase instance: applies cleanly, re-run refused, then all 199 SQL assertions pass. First Super Admin via dashboard + one SQL call (DEPLOYMENT §3). Future migrations: give the owner the new file(s) to paste in order.

**Migrations applied in production by the owner:** 0001–0016 (via production-setup.sql), 0017 (SQL Editor, 2026-11-19). 0018 and 0019 (SQL Editor, 2026-11-19; owner confirmed Analytics works). 0020 (owner verified 2026-11-19). 0021–0027 (SQL Editor, 2026-11-20; owner confirmed). 0028 and 0029 (SQL Editor, 2026-11-20; owner confirmed). 0030–0034 (SQL Editor, 2026-11-20; owner verified with a check query — 0031/0032 had already been applied once). 0035 and 0036 (SQL Editor, 2026-11-20; owner verified with a check query). 0037 and 0038 (SQL Editor, 2026-11-20; owner confirmed). 0039–0046 (SQL Editor, 2026-11-21; owner verified all with a check query). 0047–0049 (SQL Editor, 2026-11-21; owner verified with a check query — 0047 had already been applied once). 0050 and 0051 (SQL Editor, 2026-11-22; owner verified with a check query). 0052 and 0053 (SQL Editor, 2026-11-22; owner verified with a check query). 0054 (SQL Editor, 2026-11-22; owner verified with a check query). 0056 (SQL Editor, 2026-11-23; owner verified with a check query). 0055 (owner verified 2026-11-23). 0057 (SQL Editor, 2026-11-23; owner verified with a check query). 0058 (SQL Editor, 2026-11-23; owner verified with a check query). 0059 (SQL Editor, 2026-11-23; owner verified with a check query). 0060 (SQL Editor, 2026-11-23; owner verified with a check query). Website live on Vercel (`fantaf.xyz`); Super Admin `fantaf.transport@gmail.com` signs in.

Owner progress so far: both Telegram groups connected (orders & payments bot + security bot, test messages received 2026-11-20); Resend domain `fantaf.xyz` + Supabase SMTP + URL configuration (`https://fantaf.xyz`) + 3 bilingual email templates done.

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
- Vercel Hobby allows only daily cron jobs, so `vercel.json` runs expiry daily (03:17 UTC); on Vercel Pro change it to hourly. Checkout also expires overdue orders on every new order.
- Product images / site assets uploaded but never attached by admins are not swept (admin-only, low volume).
- Word (.docx) page counts are not automatic (layout-dependent); staff quote them. Customers are not messaged when a quote is ready — they revisit the job link (saved on the job page), or staff call them.
- Deactivating a customer does not cancel their open unpaid orders (they expire at the payment deadline, or staff cancel them). A deactivated customer can still open an order via its private link/tracking code.
- Customer notifications are email only (no SMS).

## Next session

1. Read `AGENTS.md` (Next.js 16 rules), this file, and `docs/ARCHITECTURE.md`.
2. Run `npm run dev:up` — starts Docker if the sandbox restarted, then local Supabase, then checks the API (data persists in Docker volumes). If the DB was reset: `npm run dev:sample-images` and `ADMIN_PASSWORD=LocalDevOwner2026 npm run admin:create -- --email owner@abiye.local --name "Abiye Owner"`.
3. All 7 phases are complete. Ask the owner which migrations production has (update the line above), then work on their requests. Ideas: customer notifications (SMS/Telegram/email when an order is confirmed or a printing quote is ready), Vercel Pro hourly crons, convert the smoke scripts into a Playwright test project.
4. Tests: `npm run check`, `npm run test:db`, then with the app on :3100 (`npx next start -p 3100` after `npm run build`) and `NODE_PATH=$(npm root -g)`: `npm run test:smoke`, `test:smoke:checkout`, `test:smoke:admin`, `test:smoke:printing`, `test:smoke:account`, `test:smoke:customers`, `test:smoke:phase7`, `test:smoke:personal-promo`, `test:smoke:mfa`, `test:smoke:emails` (own app on :3102), `test:smoke:help`, `test:smoke:pwa`, `test:smoke:push` (own app on :3103), `test:smoke:export`, `test:smoke:staff-portal`, `test:smoke:wallet`, `test:smoke:security`; and `npm run test:smoke:telegram` (starts its own app on :3101). Clear `rate_limits` between runs (`delete from rate_limits`) — repeated admin logins hit the login rate limit. Update this file.
