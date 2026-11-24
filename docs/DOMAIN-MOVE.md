# Moving from fantaf.xyz to abiye.site

The code has no domain written in it: every address comes from Vercel settings. The move is done in the
dashboards, in this order. Keep fantaf.xyz connected until the end — it then forwards everyone to abiye.site.

| Old | New | Who |
|---|---|---|
| fantaf.xyz | **abiye.site** | customers |
| ocs.fantaf.xyz | **ocs.abiye.site** | managers / staff |
| operations.fantaf.xyz | **operations.abiye.site** | Super Admin |
| courier.fantaf.xyz | **courier.abiye.site** | couriers |

## 1. Vercel — add the new addresses
Project → Settings → **Domains** → Add `abiye.site`, `www.abiye.site` (redirect to `abiye.site`), `ocs.abiye.site`,
`operations.abiye.site`, `courier.abiye.site` (Production). At your abiye.site registrar add the DNS records Vercel shows
(A record for `abiye.site`, CNAME for the others). Wait for **Valid Configuration** on all five.

## 2. Resend — emails from the new domain
Resend → Domains → **Add domain** `abiye.site`, add its DNS records (SPF, DKIM, and the MX for bounces) at the registrar,
wait for **Verified**. Keep fantaf.xyz verified until step 4 is done.

## 3. Supabase — sign-in links
Authentication → **URL Configuration**:
- Site URL: `https://abiye.site`
- Redirect URLs: add `https://abiye.site/**`, `https://ocs.abiye.site/**`, `https://operations.abiye.site/**`, `https://courier.abiye.site/**`
  (remove the fantaf.xyz ones only after step 6).
Authentication → **Email Templates**: check none of the texts mention fantaf.xyz (the links use the Site URL automatically).

## 4. Vercel — switch the settings (one redeploy)
Settings → **Environment Variables** (Production), change:
- `APP_URL` = `https://abiye.site`
- `CUSTOMER_HOST` = `abiye.site`
- `STAFF_HOST` = `ocs.abiye.site`
- `SUPER_ADMIN_HOST` = `operations.abiye.site`
- `COURIER_HOST` = `courier.abiye.site`
- `EMAIL_FROM` = `Abiye <orders@abiye.site>` (only once Resend shows abiye.site Verified)
Then **Deployments → newest → Redeploy** (and **Promote** if it shows Stale).

## 5. Vercel — forward the old addresses
Settings → **Domains** → each fantaf.xyz address → **Edit** → *Redirect to*:
`fantaf.xyz` → `abiye.site`, `www.fantaf.xyz` → `abiye.site`, `ocs.fantaf.xyz` → `ocs.abiye.site`,
`operations.fantaf.xyz` → `operations.abiye.site`, `courier.fantaf.xyz` → `courier.abiye.site` (308 permanent).
Old links, bookmarks and emails keep working.

## 6. Check
- `https://operations.abiye.site/admin` — you sign in (password + code). Admin → Security → Site health all green.
- `https://abiye.site` — shop; place a test order; the email comes from orders@abiye.site with abiye.site links.
- Telegram "Open in admin" links now open ocs / operations.abiye.site.
- `https://courier.abiye.site` — a courier signs in.
- Admin → Settings: check your own texts (About us, terms, privacy, contact) for "fantaf.xyz" and change them.

## What people notice
- **Everyone signs in once more** on the new address (sign-ins belong to an address). Passwords and two-step codes stay the same.
- **Installed apps**: remove the old one and install again from the new address (customers: abiye.site; staff: ocs; couriers: courier).
- **Phone notifications**: customers switch them on again on abiye.site (they belong to the address).
- Customers' baskets that were not checked out are not carried over.
- Orders, accounts, balances, promotions, history: unchanged (same database).
