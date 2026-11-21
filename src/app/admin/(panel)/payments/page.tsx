import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { PageHeader, SubTabs, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Payments" };
const TABS = [
  { key: "pending", label: "To verify" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
] as const;

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const ctx = await requirePermission("payments.view");
  const requested = first((await searchParams).status);
  const status = TABS.find((t) => t.key === requested)?.key ?? "pending";
  const supabase = await createSupabaseServerClient();
  const { data: subs, error } = await supabase
    .from("payment_submissions")
    .select("id, order_id, transaction_reference, amount_expected_etb, submitted_at, reviewed_at, order:orders(order_number, total_etb)")
    .eq("status", status)
    .order("submitted_at", { ascending: status === "pending" })
    .limit(200);
  if (error) throw new Error("Could not load payments");

  // Flag references that appear on more than one submission (possible reuse of one transfer).
  const refs = [...new Set(subs.map((s) => s.transaction_reference?.toLowerCase()).filter(Boolean))] as string[];
  const { data: refRows } = refs.length
    ? await supabase.from("payment_submissions").select("id, order_id, transaction_reference").in("transaction_reference", subs.map((s) => s.transaction_reference!).filter(Boolean))
    : { data: [] as { id: string; order_id: string; transaction_reference: string | null }[] };
  const reused = new Set(
    refs.filter((r) => new Set((refRows ?? []).filter((x) => x.transaction_reference?.toLowerCase() === r).map((x) => x.order_id)).size > 1),
  );
  const canTopups = ctx.permissions.has("wallet.manage");
  const now = new Date().getTime() + 3 * 3600 * 1000; // Addis Ababa
  const today = new Date(now).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;

  return (
    <>
      <PageHeader title="Payments" description="Check every transfer in the bank account before verifying. A screenshot alone is not proof of payment." />
      <details className="mb-4 rounded-lg border bg-card p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><FileSpreadsheet className="size-4 text-primary" aria-hidden /> Export verified &amp; rejected payments to Excel</summary>
        <form method="get" action="/admin/payments/export" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">Decided from<input type="date" name="from" required defaultValue={monthStart} max={today} className={`${fieldClass} mt-1 block`} /></label>
          <label className="text-sm">To<input type="date" name="to" required defaultValue={today} max={today} className={`${fieldClass} mt-1 block`} /></label>
          <label className="text-sm">Include
            <select name="status" defaultValue="all" className={`${fieldClass} mt-1 block w-auto`}>
              <option value="all">Verified and rejected</option>
              <option value="verified">Verified only</option>
              <option value="rejected">Rejected only</option>
            </select>
          </label>
          {canTopups && (
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="topups" value="1" defaultChecked className="size-4 accent-[var(--primary)]" /> Include wallet top-ups
            </label>
          )}
          <Button type="submit"><Download /> Download .xlsx</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Sheets: Summary (counts and amounts), Order payments{canTopups ? " and Wallet top-ups" : ""}. Each row: result, when and by whom it was decided, the reason for rejections,
          order, customer (name, phone, email), amount, bank account, bank reference, receipt and warnings (reused reference or receipt, amount mismatch).
          Dates in Ethiopia time. The file contains customer contact details — store it safely. Each export is recorded in the Activity log.
        </p>
      </details>
      <SubTabs base="/admin/payments" param="status" tabs={TABS} active={status} />
      <Table scroll head={["Order", "Submitted", status === "pending" ? "Checks" : "Decided"]}
        empty={status === "pending" ? "No payments waiting for verification." : `No ${status} payments.`}>
        {subs.map((s) => {
          const order = s.order!;
          const warn = (s.transaction_reference && reused.has(s.transaction_reference.toLowerCase())) || Number(s.amount_expected_etb) !== Number(order.total_etb);
          return (
            <tr key={s.id}>
              <Td><Link href={`/admin/payments/${s.id}`} className="font-mono font-semibold text-primary underline-offset-2 hover:underline">{order.order_number}</Link></Td>
              <Td className="text-xs text-muted-foreground">{formatDateTime(s.submitted_at, "en")}</Td>
              <Td>
                {status === "pending"
                  ? (warn ? <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="size-3.5" aria-hidden /> Check carefully</span> : <span className="text-xs text-muted-foreground">—</span>)
                  : <Badge variant={status === "verified" ? "success" : "destructive"}>{status}{s.reviewed_at ? ` ${formatDateTime(s.reviewed_at, "en")}` : ""}</Badge>}
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
