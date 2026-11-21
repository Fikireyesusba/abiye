import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { PrintButton } from "@/components/admin/print-button";
import { DatabaseUpdateNeeded, PageHeader, Panel, Table, Td, fieldClass, isMissingDbFunction } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { reportRange, reportTitle, type SalesReport } from "@/lib/admin/sales-report";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime, zoneToday } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sales reports" };

const etb = (v: number) => formatETB(toSantim(Number(v ?? 0)), "en");

function Row({ label, value, strong, muted }: { label: string; value: string | number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 py-1.5", strong && "border-t pt-2.5 text-base font-semibold", muted && "pl-4 text-muted-foreground")}>
      <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const ctx = await requirePermission("analytics.view");
  const sp = await searchParams;
  const today = zoneToday();
  const range = reportRange(first(sp.kind), first(sp.value), today);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_sales_report", { p_from: range.from, p_to: range.to });
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Sales reports" migration="20261120000033_sales_reports.sql" />;
  if (error || !data) throw new Error("Could not load the report");
  const r = data as unknown as SalesReport;
  const t = r.totals;
  const title = reportTitle(range);
  const exportHref = `/admin/reports/export?${new URLSearchParams({ kind: range.kind, value: range.value })}`;

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Sales reports" description="Money is counted on the day the payment was verified (Warsaw time), so the figures match your bank statement. Print or export to Excel for your accountant." />
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="kind" value="day" />
            <label className="text-sm">Day<input type="date" name="value" defaultValue={range.kind === "day" ? range.value : today} max={today} className={`${fieldClass} mt-1 block`} /></label>
            <Button type="submit" variant={range.kind === "day" ? "default" : "outline"}>Daily closing</Button>
          </form>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="kind" value="month" />
            <label className="text-sm">Month<input type="month" name="value" defaultValue={range.kind === "month" ? range.value : today.slice(0, 7)} max={today.slice(0, 7)} className={`${fieldClass} mt-1 block`} /></label>
            <Button type="submit" variant={range.kind === "month" ? "default" : "outline"}>Monthly statement</Button>
          </form>
          <div className="ml-auto flex gap-2">
            <PrintButton />
            <Button asChild><a href={exportHref}><Download /> Excel</a></Button>
          </div>
        </div>
      </div>

      <h2 className="mb-1 text-xl font-semibold">{title}</h2>
      <p className="mb-5 text-sm text-muted-foreground">Period {r.from} to {r.to} (Warsaw time) · printed by {ctx.fullName} · {formatDateTime(new Date().toISOString(), "en")}</p>

      <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
        <Panel title="Sales">
          <dl className="text-sm">
            <Row label="Orders placed" value={t.orders_placed} />
            <Row label="Orders paid" value={t.orders_paid} />
            <Row label="Products" value={etb(t.products_sales)} muted />
            <Row label="Printing" value={etb(t.printing_sales)} muted />
            <Row label="Delivery fees" value={etb(t.delivery_fees)} muted />
            <Row label="Discounts given" value={`−${etb(t.discounts)}`} muted />
            <Row label="Sales (paid orders)" value={etb(t.sales)} strong />
            <Row label="Average paid order" value={etb(t.average_order)} />
          </dl>
        </Panel>
        <Panel title="Money in">
          <dl className="text-sm">
            <Row label="Orders paid by bank transfer" value={etb(t.paid_by_bank)} />
            <Row label={`Wallet top-ups verified (${t.topups_count})`} value={etb(t.topups_amount)} />
            <Row label="Money into your bank" value={etb(t.cash_in)} strong />
            <Row label="Orders paid with customer balance" value={etb(t.paid_by_wallet)} />
            <p className="pt-1 text-xs text-muted-foreground">Balance payments are not new money: it arrived earlier as top-ups.</p>
            {(t.cancelled_after_payment_count > 0 || Number(t.wallet_refunds) > 0) && (
              <>
                <Row label={`Cancelled after payment (${t.cancelled_after_payment_count})`} value="" />
                <Row label="Bank transfers to refund" value={etb(t.cancelled_after_payment_bank)} muted />
                <Row label="Refunded to customer balances" value={etb(t.wallet_refunds)} muted />
              </>
            )}
          </dl>
        </Panel>
      </div>

      <h3 className="mt-6 mb-2 font-semibold">By bank account</h3>
      <Table head={["Bank", "Account", "Orders", "Order payments", "Top-ups", "Top-up amount", "Total in"]} empty="No money received in this period.">
        {r.by_bank.map((b) => (
          <tr key={`${b.bank}-${b.account}`}>
            <Td>{b.bank}</Td><Td className="font-mono text-xs">{b.account}</Td><Td className="tabular-nums">{b.orders}</Td>
            <Td className="tabular-nums">{etb(b.orders_amount)}</Td><Td className="tabular-nums">{b.topups}</Td>
            <Td className="tabular-nums">{etb(b.topups_amount)}</Td><Td className="font-semibold tabular-nums">{etb(b.total)}</Td>
          </tr>
        ))}
      </Table>

      {range.kind === "month" && (
        <>
          <h3 className="mt-6 mb-2 font-semibold">By day</h3>
          <Table head={["Day", "Placed", "Paid", "Sales", "Bank", "Balance", "Top-ups"]}>
            {r.by_day.map((d) => (
              <tr key={d.day}>
                <Td><Link href={`/admin/reports?kind=day&value=${d.day}`} className="text-primary hover:underline print:text-foreground">{d.day}</Link></Td>
                <Td className="tabular-nums">{d.placed}</Td><Td className="tabular-nums">{d.paid}</Td><Td className="tabular-nums">{etb(d.sales)}</Td>
                <Td className="tabular-nums">{etb(d.bank)}</Td><Td className="tabular-nums">{etb(d.wallet)}</Td><Td className="tabular-nums">{etb(d.topups)}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2 print:grid-cols-2">
        <div>
          <h3 className="mb-2 font-semibold">Payments verified by</h3>
          <Table head={["Staff member", "Payments", "Amount"]} empty="No bank payments verified.">
            {r.by_staff.map((s, i) => (
              <tr key={i}><Td>{s.name ?? "Unknown"}</Td><Td className="tabular-nums">{s.payments}</Td><Td className="tabular-nums">{etb(s.amount)}</Td></tr>
            ))}
          </Table>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Top products</h3>
          <Table head={["Product", "Qty", "Amount"]} empty="No products sold.">
            {r.top_products.map((p) => (
              <tr key={`${p.sku}-${p.name}`}><Td>{p.name}</Td><Td className="tabular-nums">{p.quantity}</Td><Td className="tabular-nums">{etb(p.amount)}</Td></tr>
            ))}
          </Table>
        </div>
      </div>

      {r.cancelled_after_payment.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 font-semibold">Cancelled after payment</h3>
          <Table head={["Order", "Customer", "Paid by", "Total", "Cancelled"]}>
            {r.cancelled_after_payment.map((c) => (
              <tr key={c.order_number}>
                <Td>{c.order_number}</Td><Td>{c.customer}</Td>
                <Td>{c.method === "wallet" ? "Balance (refunded automatically)" : <span className="text-destructive">Bank — refund due</span>}</Td>
                <Td className="tabular-nums">{etb(c.total)}</Td><Td className="text-xs">{formatDateTime(c.cancelled_at, "en")}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
