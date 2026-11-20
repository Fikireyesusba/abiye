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

**Migrations applied in production by the owner:** 0001–0016 (via production-setup.sql), 0017 (SQL Editor, 2026-11-19). 0018 and 0019 (SQL Editor, 2026-11-19; owner confirmed Analytics works). 0020 (owner verified 2026-11-19). 0021–0027 (SQL Editor, 2026-11-20; owner confirmed). 0028 and 0029 (SQL Editor, 2026-11-20; owner confirmed). Pending: none. Website live on Vercel (`fantaf.xyz`); Super Admin `fantaf.transport@gmail.com` signs in.

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
