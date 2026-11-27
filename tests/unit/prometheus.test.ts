import { describe, expect, it } from "vitest";
import { toPrometheus } from "@/lib/monitoring/prometheus";

describe("Grafana metrics (Prometheus text)", () => {
  const text = toPrometheus({
    orders_by_status: { confirmed: 3, out_for_delivery: 1 }, revenue_today_etb: "1850.00", payments_pending: 2,
    deliveries: { waiting_courier: 1, on_the_way: 1 }, deliveries_late: { not_picked_up: 1 },
    security_events_24h: { admin_login_failed: 4 }, cron_last_run_age_seconds: { "expire-orders": 3600 }, documents_expired: 1,
  });
  it("one line per value, with HELP / TYPE, labels and every order status", () => {
    for (const line of [
      "# TYPE abiye_orders gauge", 'abiye_orders{status="confirmed"} 3', 'abiye_orders{status="expired"} 0',
      "abiye_revenue_today_etb 1850", "abiye_payments_pending 2", 'abiye_deliveries{stage="waiting_courier"} 1', 'abiye_deliveries{stage="locked"} 0',
      'abiye_deliveries_late{kind="not_picked_up"} 1', 'abiye_deliveries_late{kind="delivery_late"} 0',
      'abiye_security_events_24h{kind="admin_login_failed"} 4', 'abiye_job_last_run_age_seconds{job="expire-orders"} 3600',
      "abiye_documents_expired 1", "abiye_up 1",
    ]) expect(text).toContain(line);
  });
  it("only numbers — nothing personal can appear", () => {
    for (const l of text.split("\n").filter((x) => x && !x.startsWith("#"))) expect(l).toMatch(/^abiye_[a-z0-9_]+(\{[a-z_]+="[A-Za-z0-9_-]+"\})? -?\d+(\.\d+)?$/);
  });
});
