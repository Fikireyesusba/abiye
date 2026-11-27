# Grafana monitoring (Grafana Cloud, browser only)

The website has a **private metrics link** — `https://abiye.site/api/metrics` — that Grafana Cloud reads every minute.
It returns **totals only** (no names, phones, emails or order contents) and only to someone who has the token.
Without the token set in Vercel the link does not exist (404).

## 1. Make the token (once)

Make a random password of **40 letters and digits** (no spaces) with your password manager's generator
(Chrome / Bitwarden / 1Password "generate password"). Keep it in your password manager. Never send it to anyone.

## 2. Vercel

Vercel → abiye project → **Settings → Environment Variables** → Add:

- Key `METRICS_TOKEN`, Value = the token from step 1, Environment **Production** → Save → **Redeploy** (Promote if it shows Stale).

Check: open `https://abiye.site/api/metrics` in the browser — it must ask for a user name and password (401). That is correct.

## 3. Grafana Cloud

1. Create a free account at grafana.com → it creates your stack (e.g. `abiye.grafana.net`).
2. **Connections → Add new connection → "Metrics Endpoint"** → Install / Add new scrape job:
   - Scrape job name: `abiye`
   - Scrape job URL: `https://abiye.site/api/metrics`
   - Type of authentication: **Basic** — Username: `grafana` (anything), Password: **the token**
   - Scrape interval: **every minute**
   - **Test connection** → **Save scrape job**.
3. **Dashboards → New → Import** → upload `docs/grafana/abiye-dashboard.json` (download it from GitHub: open the file → "Download raw file")
   → choose the Prometheus data source (`grafanacloud-…-prom`) → **Import**.

The dashboard: Shop today (website up, revenue, paid orders, payments to verify and how long the oldest waits, orders by status),
Deliveries (waiting for a courier, late, couriers online, delivered today, wrong PINs, locked orders, by stage / problem),
Customers, stock, support and documents, System health and security (stuck / failed notifications, virus scan problems,
delivery monitor and daily jobs running, database size, security events).

## 4. Alerts (Grafana → Alerting)

**Contact point** (Alerting → Contact points → Add): **Telegram** (bot token + chat id of one of your groups — typed in Grafana only)
or **Email**. Then Alerting → Alert rules → New alert rule, data source Prometheus, one rule per line below
(Folder `Abiye`, evaluate every 1 m):

| Alert | Query | Condition | Pending for |
|---|---|---|---|
| Website / database down | `max(abiye_up)` (and "No data" → Alerting) | below 1 | 5 m |
| Payment waiting too long | `max(abiye_payments_oldest_pending_minutes)` | above 60 | 0 |
| Paid orders without a courier | `max(abiye_deliveries{stage="waiting_courier"})` | above 0 | 30 m |
| Late deliveries | `sum(abiye_deliveries_late)` | above 0 | 10 m |
| Orders locked by wrong PINs | `max(abiye_deliveries{stage="locked"})` | above 0 | 0 |
| Many wrong PINs | `max(abiye_wrong_pins_today)` | above 5 | 0 |
| Notifications stuck | `max(abiye_notifications_backlog)` | above 0 | 15 m |
| Virus scan not working | `max(abiye_upload_scans_24h{result="unavailable"})` | above 0 | 0 |
| Daily job not running | `max(abiye_job_last_run_age_seconds)` | above 93600 (26 h) | 0 |
| Many failed staff sign-ins | `sum(abiye_security_events_24h{kind=~"admin_login_failed|admin_mfa_failed"})` | above 10 | 0 |
| Database nearly full (free plan 500 MB) | `max(abiye_database_size_bytes)` | above 450000000 | 0 |

(The shop already sends most of these to Telegram itself; Grafana adds history charts and alerts when the **website itself** is down,
which the website cannot report.)

## 5. Optional: Supabase server metrics

Grafana Cloud → **Connections → Add new connection → "Supabase"** → follow its steps (project reference + the Supabase **secret
(service role) key** as the password; it is stored in Grafana only). Adds database CPU, memory, connections and disk charts.
Only do this if you are comfortable keeping that key in Grafana; the shop metrics above do not need it.

## Metrics list (for your own panels)

`abiye_up`, `abiye_orders{status}`, `abiye_orders_created_today`, `abiye_orders_paid_today`, `abiye_orders_completed_today`,
`abiye_orders_cancelled_today`, `abiye_revenue_today_etb`, `abiye_revenue_month_etb`, `abiye_payments_pending`,
`abiye_payments_oldest_pending_minutes`, `abiye_topups_pending`, `abiye_deliveries{stage}`, `abiye_deliveries_late{kind}`,
`abiye_delivered_today`, `abiye_couriers_online`, `abiye_couriers_active`, `abiye_wrong_pins_today`, `abiye_printing_jobs{status}`,
`abiye_support_open`, `abiye_accounts_pending_approval`, `abiye_signups_today`, `abiye_customers_total`, `abiye_products_active`,
`abiye_products_low_stock`, `abiye_products_out_of_stock`, `abiye_notifications_24h{status}`, `abiye_notifications_backlog`,
`abiye_security_events_24h{kind}`, `abiye_upload_scans_24h{result}`, `abiye_documents_expiring_30d`, `abiye_documents_expired`,
`abiye_job_last_run_age_seconds{job}`, `abiye_job_last_ok{job}`, `abiye_delivery_monitor_last_check_age_seconds`, `abiye_database_size_bytes`.

To stop: delete `METRICS_TOKEN` in Vercel (redeploy) — the link disappears. To change the token: change it in Vercel and in the Grafana scrape job.
