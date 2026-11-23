/** Staff KPIs: how each is measured, and whether a higher or lower value is better. */
export const KPI_METRICS = [
  { key: "tickets_resolved", label: "Tickets resolved", unit: "", better: "higher", help: "Support tickets this person set to Resolved or Closed." },
  { key: "ticket_resolution_hours", label: "Ticket resolution time", unit: "h", better: "lower", help: "Average hours from the customer's report to resolved / closed (their tickets)." },
  { key: "ticket_first_reply_hours", label: "First reply time", unit: "h", better: "lower", help: "Average hours until this person's first answer to a new ticket." },
  { key: "orders_completed", label: "Orders completed", unit: "", better: "higher", help: "Orders this person marked Completed (delivered / collected)." },
  { key: "payments_approved", label: "Payments approved", unit: "", better: "higher", help: "Bank payments this person verified." },
  { key: "payment_review_minutes", label: "Payment review time", unit: "min", better: "lower", help: "Average minutes from receipt upload to this person's decision." },
  { key: "topups_approved", label: "Top-ups approved", unit: "", better: "higher", help: "Wallet top-ups this person verified." },
  { key: "printing_completed", label: "Printing jobs completed", unit: "", better: "higher", help: "Printing jobs this person marked Completed." },
  { key: "instore_sales", label: "In-store sales", unit: "", better: "higher", help: "Sales this person recorded in the shop (not voided)." },
] as const;
export type KpiMetric = (typeof KPI_METRICS)[number]["key"];
export const KPI_PERIODS = [{ key: "day", label: "per day", days: 1 }, { key: "week", label: "per week", days: 7 }, { key: "month", label: "per month", days: 30 }] as const;

/**
 * Target for a date range: counts scale with the number of days (a target of 20 per week over 14 days = 40);
 * times ("lower is better") are an upper limit whatever the period.
 */
export function scaledTarget(metric: KpiMetric, target: number, period: string, rangeDays: number): number {
  const m = KPI_METRICS.find((x) => x.key === metric)!;
  if (m.better === "lower") return target;
  const per = KPI_PERIODS.find((p) => p.key === period)?.days ?? 30;
  return Math.round((target * rangeDays / per) * 10) / 10;
}

/** % of the target reached (100 = met). For times: target ÷ actual. Null when it cannot be judged. */
export function achievement(metric: KpiMetric, actual: number | null, target: number | null): number | null {
  if (target === null || actual === null) return null;
  const m = KPI_METRICS.find((x) => x.key === metric)!;
  if (m.better === "lower") return actual <= 0 ? 100 : Math.round(Math.min(200, (target / actual) * 100));
  return target <= 0 ? 100 : Math.round((actual / target) * 100);
}
