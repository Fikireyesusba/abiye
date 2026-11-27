/**
 * Prometheus text format (what Grafana Cloud's "Metrics Endpoint" integration reads) from the database's
 * metrics_snapshot(): totals only — no names, phones, emails or order contents.
 */
type Snap = Record<string, unknown>;
type Metric = { name: string; help: string; type?: "gauge" | "counter"; values: [Record<string, string> | null, number][] };

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const map = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const one = (name: string, help: string, v: unknown): Metric => ({ name, help, values: [[null, num(v)]] });
const byLabel = (name: string, help: string, label: string, v: unknown, always: string[] = []): Metric => {
  const m = map(v);
  const keys = [...new Set([...always, ...Object.keys(m)])];
  return { name, help, values: keys.map((k) => [{ [label]: k }, num(m[k])]) };
};

const ORDER_STATUSES = ["awaiting_payment", "pending_verification", "payment_rejected", "confirmed", "processing", "ready_for_pickup", "out_for_delivery", "completed", "cancelled", "expired"];

export function toPrometheus(s: Snap): string {
  const d = map(s.deliveries);
  const metrics: Metric[] = [
    byLabel("abiye_orders", "Orders by status (open ones, plus those that finished today)", "status", s.orders_by_status, ORDER_STATUSES),
    one("abiye_orders_created_today", "Orders placed today", s.orders_created_today),
    one("abiye_orders_paid_today", "Orders whose payment was verified today", s.orders_paid_today),
    one("abiye_orders_completed_today", "Orders completed today", s.orders_completed_today),
    one("abiye_orders_cancelled_today", "Orders cancelled today", s.orders_cancelled_today),
    one("abiye_revenue_today_etb", "Verified revenue today (ETB)", s.revenue_today_etb),
    one("abiye_revenue_month_etb", "Verified revenue this month (ETB)", s.revenue_month_etb),
    one("abiye_payments_pending", "Payment receipts waiting for verification", s.payments_pending),
    one("abiye_payments_oldest_pending_minutes", "Minutes the oldest waiting payment has waited", s.payments_oldest_pending_minutes),
    one("abiye_topups_pending", "Wallet top-ups waiting for verification", s.topups_pending),
    { name: "abiye_deliveries", help: "Paid delivery / partner-shop orders by stage",
      values: ["waiting_courier", "to_pick_up", "on_the_way", "at_partner_shops", "locked"].map((k) => [{ stage: k }, num(d[k])]) },
    byLabel("abiye_deliveries_late", "Late deliveries (delivery monitor limits)", "kind", s.deliveries_late, ["not_dispatched", "not_picked_up", "delivery_late", "not_collected"]),
    one("abiye_delivered_today", "Deliveries / partner-shop pickups completed today", s.delivered_today),
    one("abiye_couriers_online", "Couriers on duty now", s.couriers_online),
    one("abiye_couriers_active", "Active courier accounts", s.couriers_active),
    one("abiye_wrong_pins_today", "Wrong PINs entered today (courier and Business apps)", s.wrong_pins_today),
    byLabel("abiye_printing_jobs", "Open printing jobs by status", "status", s.printing_jobs),
    one("abiye_support_open", "Open support tickets", s.support_open),
    one("abiye_accounts_pending_approval", "New customer accounts waiting for approval", s.accounts_pending_approval),
    one("abiye_signups_today", "Customer accounts created today", s.signups_today),
    one("abiye_customers_total", "Customer accounts", s.customers_total),
    one("abiye_products_active", "Products on sale", s.products_active),
    one("abiye_products_low_stock", "Products at or below their low-stock level", s.products_low_stock),
    one("abiye_products_out_of_stock", "Products sold out", s.products_out_of_stock),
    byLabel("abiye_notifications_24h", "Notifications (Telegram / email / phone) in the last 24 h by status", "status", s.notifications_24h, ["pending", "processing", "sent", "failed", "dead"]),
    one("abiye_notifications_backlog", "Notifications not sent after 10 minutes", s.notifications_backlog),
    byLabel("abiye_security_events_24h", "Security events in the last 24 h by kind", "kind", s.security_events_24h),
    byLabel("abiye_upload_scans_24h", "Virus scans of uploads in the last 24 h by result", "result", s.upload_scans_24h, ["clean", "blocked", "unavailable"]),
    one("abiye_documents_expiring_30d", "Documents / insurance / licences expiring within 30 days", s.documents_expiring_30d),
    one("abiye_documents_expired", "Documents / insurance / licences already expired", s.documents_expired),
    byLabel("abiye_job_last_run_age_seconds", "Seconds since each daily job last ran", "job", s.cron_last_run_age_seconds),
    byLabel("abiye_job_last_ok", "1 if the job's last run succeeded", "job", s.cron_last_ok),
    one("abiye_delivery_monitor_last_check_age_seconds", "Seconds since the delivery monitor last checked (-1 = never)", s.monitor_last_scan_age_seconds),
    one("abiye_database_size_bytes", "Database size", s.database_size_bytes),
  ];
  const out: string[] = [];
  for (const m of metrics) {
    out.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type ?? "gauge"}`);
    for (const [labels, v] of m.values) {
      const l = labels ? `{${Object.entries(labels).map(([k, val]) => `${k}="${esc(val)}"`).join(",")}}` : "";
      out.push(`${m.name}${l} ${Number.isFinite(v) ? v : 0}`);
    }
  }
  out.push("# HELP abiye_up 1 when the website could read the database", "# TYPE abiye_up gauge", "abiye_up 1");
  return out.join("\n") + "\n";
}
