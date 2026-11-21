import type { Metadata } from "next";
import Link from "next/link";
import { BarChart } from "@/components/admin/bar-chart";
import { DatabaseUpdateNeeded, PageHeader, Panel, StatCard, SubTabs, Table, Td, fieldClass, isMissingDbFunction, pickTab } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

interface Analytics {
  money: boolean;
  bucket: "day" | "week" | "month";
  totals: {
    orders_placed: number; orders_paid: number; orders_expired: number; orders_cancelled: number; items_sold: number;
    revenue: number | null; products_revenue: number | null; printing_revenue: number | null; delivery_fees: number | null;
    discounts: number | null; average_order: number | null;
  };
  series: { bucket: string; orders: number; paid: number; revenue: number | null }[];
  by_category: { name: string; department: string | null; qty: number; revenue: number | null }[];
  best_sellers: { product_id: string; name: string; sku: string; qty: number; revenue: number | null }[];
  statuses: Record<string, number>;
  fulfillment: Record<string, number>;
  promotions: { name: string; code: string | null; orders: number; discount: number | null }[];
  inventory: { active_products: number; tracked: number; out_of_stock: number; low_stock: number; units_in_stock: number; stock_value: number | null };
}

const RANGES = [
  { key: "7d", label: "7 days", days: 7, bucket: "day" },
  { key: "30d", label: "30 days", days: 30, bucket: "day" },
  { key: "90d", label: "90 days", days: 90, bucket: "week" },
  { key: "12m", label: "12 months", days: 365, bucket: "month" },
] as const;

/** Today's date in Addis Ababa (YYYY-MM-DD). */
const addisToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const shiftDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const etb = (n: number | null) => (n === null ? "—" : formatETB(toSantim(n)));

function bucketLabel(day: string, bucket: Analytics["bucket"], full = false) {
  const d = new Date(`${day}T12:00:00Z`);
  if (bucket === "month") return d.toLocaleDateString("en-GB", { month: full ? "long" : "short", year: full ? "numeric" : undefined, timeZone: "UTC" });
  if (bucket === "week") return `${full ? "Week of " : ""}${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  return full ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : String(d.getUTCDate());
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  await requirePermission("analytics.view", "reports.operational");
  const sp = await searchParams;
  const today = addisToday();
  const preset = RANGES.find((r) => r.key === first(sp.range)) ?? (first(sp.from) ? null : RANGES[1]);
  let from = preset ? shiftDays(today, -(preset.days - 1)) : (first(sp.from) ?? "");
  let to = preset ? today : (first(sp.to) ?? "");
  if (!DATE.test(from) || !DATE.test(to) || to < from) { from = shiftDays(today, -29); to = today; }
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (span > 731) from = shiftDays(to, -731);
  const requested = first(sp.bucket);
  const bucket = preset?.bucket ?? (requested === "week" || requested === "month" ? requested : span > 120 ? "month" : span > 45 ? "week" : "day");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_analytics", { p_from: from, p_to: to, p_bucket: bucket });
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Analytics" migration="20261120000019_finalization.sql" />;
  if (error || !data) throw new Error("Could not load analytics");
  const a = data as unknown as Analytics;
  const t = a.totals;
  const statusTotal = Object.values(a.statuses).reduce((s, n) => s + n, 0);
  const catMax = Math.max(1, ...a.by_category.map((c) => (a.money ? Number(c.revenue) : c.qty)));
  const conversion = t.orders_placed ? Math.round((100 * t.orders_paid) / t.orders_placed) : null;
  const TABS = [
    { key: "trends", label: "Trends" },
    { key: "mix", label: "Categories & status" },
    { key: "best", label: "Best sellers", count: a.best_sellers.length },
    { key: "stock", label: "Inventory & promo codes" },
  ];
  const tab = pickTab(TABS, sp.tab);
  // Keep the chosen period when switching sections.
  const keep = preset ? { range: preset.key } : { from, to, bucket };

  return (
    <>
      <PageHeader title="Analytics" description={`${from} to ${to} (Ethiopia time). Sales count when the payment is verified.${a.money ? "" : " Money figures are visible to Super Admins."}`} />
      <div className="mb-6 flex flex-wrap items-end gap-2">
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/admin/analytics?range=${r.key}&tab=${tab}`} aria-current={preset?.key === r.key ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm", preset?.key === r.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {r.label}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-xs">From<input type="date" name="from" defaultValue={from} max={today} className={`${fieldClass} mt-1 h-9`} /></label>
          <label className="text-xs">To<input type="date" name="to" defaultValue={to} max={today} className={`${fieldClass} mt-1 h-9`} /></label>
          <label className="text-xs">Group by
            <select name="bucket" defaultValue={bucket} className={`${fieldClass} mt-1 h-9`}>
              <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
            </select>
          </label>
          <input type="hidden" name="tab" value={tab} />
          <Button type="submit" variant="outline" size="sm">Show</Button>
        </form>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        {a.money && <StatCard label="Revenue (verified)" value={etb(t.revenue)} hint={`Products ${etb(t.products_revenue)} · Printing ${etb(t.printing_revenue)}`} />}
        {a.money && <StatCard label="Average order" value={etb(t.average_order)} hint={`Delivery fees ${etb(t.delivery_fees)} · Discounts ${etb(t.discounts)}`} />}
        <StatCard label="Orders placed" value={t.orders_placed} hint={`${t.orders_paid} paid${conversion !== null ? ` · ${conversion}% of placed` : ""}`} />
        <StatCard label="Items sold" value={t.items_sold} hint={`${t.orders_expired} expired · ${t.orders_cancelled} cancelled`} />
      </div>

      <SubTabs base="/admin/analytics" tabs={TABS} active={tab} keep={keep} />
      {tab === "trends" && (
      <div className="grid items-start gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title={a.money ? `Verified revenue per ${a.bucket} (ETB)` : `Paid orders per ${a.bucket}`}>
          <BarChart
            title={a.money ? `Verified revenue per ${a.bucket}` : `Paid orders per ${a.bucket}`}
            data={a.series.map((s) => ({
              label: bucketLabel(s.bucket, a.bucket), full: bucketLabel(s.bucket, a.bucket, true),
              value: a.money ? Number(s.revenue) : s.paid,
              display: a.money ? etb(Number(s.revenue)) : `${s.paid} paid`,
            }))}
          />
        </Panel>
        <Panel title={`Orders placed per ${a.bucket}`}>
          <BarChart
            title={`Orders placed per ${a.bucket}`}
            data={a.series.map((s) => ({
              label: bucketLabel(s.bucket, a.bucket), full: bucketLabel(s.bucket, a.bucket, true), value: s.orders, display: `${s.orders} orders`,
            }))}
          />
        </Panel>
      </div>
      )}

      {tab === "mix" && (
      <div className="grid items-start gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Sales by category" scroll>
          {a.by_category.length === 0 ? <p className="text-sm text-muted-foreground">No paid orders in this period.</p> : (
            <ul className="space-y-3">
              {a.by_category.map((c) => {
                const v = a.money ? Number(c.revenue) : c.qty;
                return (
                  <li key={`${c.department}-${c.name}`} className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><span>{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">{c.qty} sold{a.money ? ` · ${etb(c.revenue)}` : ""}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(100 * v) / catMax}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Order status (orders placed in this period)">
          {statusTotal === 0 ? <p className="text-sm text-muted-foreground">No orders in this period.</p> : (
            <ul className="space-y-2 text-sm">
              {Object.entries(a.statuses).sort((x, y) => y[1] - x[1]).map(([s, n]) => (
                <li key={s} className="flex items-center justify-between gap-3">
                  <StatusBadge kind="order" status={s} />
                  <span className="tabular-nums">{n} <span className="text-muted-foreground">({Math.round((100 * n) / statusTotal)}%)</span></span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-2 text-muted-foreground">
                <span>Delivery / pickup</span><span className="tabular-nums">{a.fulfillment.delivery ?? 0} / {a.fulfillment.pickup ?? 0}</span>
              </li>
            </ul>
          )}
        </Panel>
      </div>
      )}

      {tab === "best" && (
      <Table scroll head={a.money ? ["#", "Product", "Sold", "Revenue"] : ["#", "Product", "Sold"]} empty="No paid orders in this period.">
        {a.best_sellers.map((b, i) => (
          <tr key={b.product_id ?? i}>
            <Td className="text-muted-foreground">{i + 1}</Td>
            <Td>{b.product_id ? <Link href={`/admin/products/${b.product_id}`} className="text-primary hover:underline">{b.name}</Link> : b.name}
              <span className="block text-xs text-muted-foreground">{b.sku}</span></Td>
            <Td className="tabular-nums">{b.qty}</Td>
            {a.money && <Td className="tabular-nums">{etb(b.revenue)}</Td>}
          </tr>
        ))}
      </Table>
      )}

      {tab === "stock" && (
      <div className="grid items-start gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Inventory now">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Active products</dt><dd className="text-lg font-semibold">{a.inventory.active_products}</dd></div>
            <div><dt className="text-muted-foreground">Units in stock</dt><dd className="text-lg font-semibold">{a.inventory.units_in_stock}</dd></div>
            <div><dt className="text-muted-foreground">Low stock</dt><dd className="text-lg font-semibold"><Link href="/admin/inventory?filter=low" className="hover:underline">{a.inventory.low_stock}</Link></dd></div>
            <div><dt className="text-muted-foreground">Out of stock</dt><dd className={cn("text-lg font-semibold", a.inventory.out_of_stock > 0 && "text-destructive")}>{a.inventory.out_of_stock}</dd></div>
            {a.money && <div className="col-span-2"><dt className="text-muted-foreground">Stock value (at selling price)</dt><dd className="text-lg font-semibold">{etb(a.inventory.stock_value)}</dd></div>}
          </dl>
        </Panel>
        <Panel title="Promo codes used" scroll>
          {a.promotions.length === 0 ? <p className="text-sm text-muted-foreground">No promo codes used in this period.</p> : (
            <ul className="space-y-2 text-sm">
              {a.promotions.map((p) => (
                <li key={`${p.code}-${p.name}`} className="flex justify-between gap-3">
                  <span>{p.name} {p.code && <span className="font-mono text-xs text-muted-foreground">{p.code}</span>}</span>
                  <span className="tabular-nums">{p.orders} order(s){a.money ? ` · −${etb(p.discount)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      )}
    </>
  );
}
