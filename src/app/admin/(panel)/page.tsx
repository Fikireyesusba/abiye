import type { Metadata } from "next";
import Link from "next/link";
import { BarChart } from "@/components/admin/bar-chart";
import { PageHeader, Panel, StatCard } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

interface Stats {
  orders_total: number;
  orders_today: number;
  awaiting_processing: number;
  awaiting_payment: number;
  pending_payments: number | null;
  products_active: number | null;
  low_stock: number | null;
  out_of_stock: number | null;
  printing_open: number | null;
  revenue_verified_total: number | null;
  revenue_verified_period: number | null;
  daily: { day: string; orders: number; revenue: number | null }[];
}

const etb = (n: number) => formatETB(toSantim(n));

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const ctx = await requirePermission("dashboard.view");
  const supabase = await createSupabaseServerClient();
  const canFollowUp = ctx.permissions.has("customers.view");
  const [{ data: raw, error }, { data: recent }, { data: stalled }] = await Promise.all([
    supabase.rpc("admin_dashboard_stats", { p_days: 14 }),
    supabase
      .from("orders")
      .select("id, order_number, customer_name, total_etb, status, payment_status, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    canFollowUp ? supabase.rpc("admin_stalled_checkouts", { p_hours: 2 }) : Promise.resolve({ data: null }),
  ]);
  if (error || !raw) throw new Error("Could not load dashboard");
  const s = raw as unknown as Stats;
  const showRevenue = s.revenue_verified_total !== null;
  // Axis shows the day of month only (fits phones); tooltip + table carry the full date.
  const dayLabel = (d: string) => String(new Date(`${d}T12:00:00Z`).getUTCDate());

  const sp = await searchParams;
  const passwordChanged = !!sp.passwordChanged;
  const mfaEnabled = !!sp.mfaEnabled;
  return (
    <>
      {mfaEnabled && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">Two-step login is on. From now on you sign in with your password and a code from your authenticator app.</p>}
      {passwordChanged && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">Your password was changed.</p>}
      <PageHeader title={`Welcome, ${ctx.fullName.split(" ")[0]}`} description="Overview of orders, payments and stock." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        {showRevenue && <StatCard label="Verified revenue" value={etb(s.revenue_verified_total!)} hint={`${etb(s.revenue_verified_period!)} in the last 14 days`} />}
        <StatCard label="Total orders" value={s.orders_total} hint={`${s.orders_today} today`} href="/admin/orders" />
        {s.pending_payments !== null && (
          <StatCard label="Payments to verify" value={s.pending_payments} href="/admin/payments?status=pending" tone={s.pending_payments > 0 ? "warning" : undefined} />
        )}
        <StatCard label="Awaiting processing" value={s.awaiting_processing} href="/admin/orders?status=confirmed" />
        <StatCard label="Awaiting payment" value={s.awaiting_payment} href="/admin/orders?status=awaiting_payment" />
        {s.products_active !== null && <StatCard label="Active products" value={s.products_active} href="/admin/products" />}
        {s.low_stock !== null && (
          <StatCard label="Low / out of stock" value={`${s.low_stock} / ${s.out_of_stock}`} href="/admin/inventory?filter=low"
            tone={(s.out_of_stock ?? 0) > 0 ? "danger" : (s.low_stock ?? 0) > 0 ? "warning" : undefined} />
        )}
        {s.printing_open !== null && <StatCard label="Open printing jobs" value={s.printing_open} />}
        {stalled && (
          <StatCard label="Stalled checkouts (2h+)" value={stalled.length} href="/admin/follow-up" hint="Not paid or basket left"
            tone={stalled.length > 0 ? "warning" : undefined} />
        )}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Panel title={showRevenue ? "Verified revenue — last 14 days (ETB)" : "Orders — last 14 days"}>
          <BarChart
            title={showRevenue ? "Verified revenue per day, last 14 days" : "Orders per day, last 14 days"}
            data={s.daily.map((d) => ({
              label: dayLabel(d.day),
              full: new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
              value: showRevenue ? Number(d.revenue) : d.orders,
              display: showRevenue ? etb(Number(d.revenue)) : `${d.orders} order${d.orders === 1 ? "" : "s"}`,
            }))}
          />
        </Panel>
        <Panel title="Recent orders" actions={<Link href="/admin/orders" className="text-sm text-primary hover:underline">View all</Link>}>
          <ul className="divide-y">
            {(recent ?? []).map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-muted/40">
                  <span className="min-w-0">
                    <span className="block font-medium">{o.order_number}</span>
                    <span className="block truncate text-xs text-muted-foreground">{o.customer_name} · {formatDateTime(o.created_at, "en")}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm tabular-nums">{etb(o.total_etb)}</span>
                    <StatusBadge kind="order" status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
            {!recent?.length && <li className="py-6 text-center text-sm text-muted-foreground">No orders yet.</li>}
          </ul>
        </Panel>
      </div>
    </>
  );
}
