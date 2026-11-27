# Grafana monitoring (Grafana Cloud, browser only)

The website has a **private metrics link** — `https://abiye.site/api/metrics` — that Grafana Cloud reads every minute.
It returns **totals only** (no names, phones, emails or order contents) and only to someone who has the token.
Until the Super Admin creates a token, the link refuses everyone.

## 1. Make the token (once) — in the admin, no Vercel variable needed

Run migrations **0077, 0078 and 0079** in Supabase first. Then, signed in as **Super Admin** at operations.abiye.site:
**Admin → Notifications → Telegram groups & alerts → "Grafana metrics link" → Create Grafana token**.
The token (40 letters / digits) is shown **once** — copy it into your password manager. Only its fingerprint is stored, so nobody
(not even you) can read it again; if it is lost, press **Create a new token** and put the new one in Grafana.
**Remove token** switches the link off.

(Alternative: a `METRICS_TOKEN` variable in Vercel also works — not needed.)

## 2. Check

Open `https://abiye.site/api/metrics` in the browser — it must ask for a user name and password (401). That is correct.

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

## 4. Alerts from Grafana to Telegram

Grafana sends the **monitoring alerts** (numbers crossing a limit). The website keeps sending the **event messages**
(payments with the receipt, printing documents, support tickets, Excel files, delivery steps, security events with details).

### 4a. Telegram contact point

Use one of your existing bots and groups (or make a new "Abiye Monitoring" group with @BotFather → /newbot, add the bot to the group).

1. Grafana → **Alerting → Contact points → + Add contact point** → Name `Telegram – Abiye` → Integration **Telegram**.
2. **BOT API Token**: the bot's token (from @BotFather; also in Vercel as `TELEGRAM_BOT_TOKEN` / `TELEGRAM_SECURITY_BOT_TOKEN` — type it here, in Grafana only).
3. **Chat ID**: the group's id (in Vercel as `TELEGRAM_ADMIN_CHAT_ID` or `TELEGRAM_SECURITY_CHAT_ID`, starts with `-100…`).
4. Optional settings → **Parse mode: HTML**, and **Message**:

```
{{ range .Alerts }}{{ if eq .Status "firing" }}🚨 <b>{{ .Labels.alertname }}</b>{{ else }}✅ <b>Resolved: {{ .Labels.alertname }}</b>{{ end }}
{{ .Annotations.summary }}
👉 {{ .Annotations.action }}
Severity: {{ .Labels.severity }}
{{ end }}
```

5. **Test** (a test message arrives in the group) → **Save contact point**.
6. **Alerting → Notification policies** → Default policy → **Edit** → Default contact point `Telegram – Abiye`
   → Group by `alertname`; Group wait `30s`; Repeat interval `4h` (a firing alert is repeated every 4 h until fixed) → **Update default policy**.
   (Optional: a second contact point for the security group and a nested policy `severity = critical` → that group.)

### 4b. Alert rules (20)

**Fastest:** Grafana → **Alerting → Alert rules** → **More → Import** (“Import to Grafana-managed rules”) → *YAML file* →
upload **docs/grafana/abiye-alert-rules.yaml** (download it from GitHub → "Download raw file") → choose the Prometheus data source
→ target folder `Abiye` → **Import**. (If your Grafana has no Import button, create the rules by hand from the table below:
Alert rules → **New alert rule** → query = the expression, condition "is above 0" is already in the expression → folder `Abiye`,
evaluation group `abiye` every `1m`, pending period as listed, labels `severity`, annotations `summary` and `action` from the YAML file.)

| Alert | Expression | Pending | Severity |
|---|---|---|---|
| Website or database down | `max(abiye_up) < 1 or absent(abiye_up)` | 5m | critical |
| Payment waiting too long | `max(abiye_payments_oldest_pending_minutes) > 60` | 0m | warning |
| Top-up waiting | `max(abiye_topups_pending) > 0` | 60m | warning |
| Paid orders without a courier | `max(abiye_deliveries{stage="waiting_courier"}) > 0` | 30m | warning |
| Late deliveries | `sum(abiye_deliveries_late) > 0` | 5m | warning |
| Orders locked by wrong PINs | `max(abiye_deliveries{stage="locked"}) > 0` | 0m | critical |
| Many wrong PINs today | `max(abiye_wrong_pins_today) > 3` | 0m | warning |
| No courier online | `max(abiye_couriers_online) < 1 and max(abiye_deliveries{stage="waiting_courier"}) > 0` | 15m | warning |
| Products sold out | `max(abiye_products_out_of_stock) > 0` | 0m | warning |
| Products low on stock | `max(abiye_products_low_stock) > 0` | 0m | info |
| Documents expiring | `max(abiye_documents_expiring_30d) > 0` | 0m | info |
| Documents expired | `max(abiye_documents_expired) > 0` | 0m | warning |
| Notifications stuck | `max(abiye_notifications_backlog) > 0` | 15m | warning |
| Notifications failing | `max(abiye_notifications_24h{status="dead"}) > 0` | 0m | warning |
| Virus scan not working | `max(abiye_upload_scans_24h{result="unavailable"}) > 0` | 0m | critical |
| Infected upload blocked | `max(abiye_upload_scans_24h{result="blocked"}) > 0` | 0m | critical |
| Daily job not running | `max(abiye_job_last_run_age_seconds) > 93600` | 0m | warning |
| Many failed staff sign-ins | `sum(abiye_security_events_24h{kind=~"admin_login_failed|admin_mfa_failed|admin_login_not_staff"}) > 10` | 0m | critical |
| Accounts waiting for approval | `max(abiye_accounts_pending_approval) > 0` | 120m | info |
| Database nearly full | `max(abiye_database_size_bytes) > 450000000` | 0m | warning |

### 4c. Switch over (no double alerts)

When a test alert from Grafana has reached Telegram: website **Admin → Notifications → Telegram activity feed** → tick
**“Monitoring alerts are sent by Grafana”** → Save. From then on the website no longer sends its own copies of: late deliveries,
wrong PINs / locked orders, documents expiring, low / out of stock. Untick it to get them from the website again
(e.g. if you stop using Grafana).

The yellow "action needed" markers, the Delivery monitor page and the Documents page in the admin keep working as before.

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

To stop: Admin → Notifications → Telegram groups & alerts → **Remove token**. To change it: **Create a new token**, then put it in the Grafana scrape job.
