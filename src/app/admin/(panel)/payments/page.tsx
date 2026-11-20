import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { ReceiptPreview } from "@/components/admin/receipt-preview";
import { PageHeader, fieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reviewPayment } from "@/lib/admin/order-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import { cn } from "@/lib/utils";

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
    .select("*, order:orders(id, order_number, customer_name, customer_phone, total_etb, status, bank_snapshot)")
    .eq("status", status)
    .order("submitted_at", { ascending: status === "pending" })
    .limit(50);
  if (error) throw new Error("Could not load payments");

  // Flag references that appear on more than one submission (possible reuse of one transfer).
  const refs = [...new Set(subs.map((s) => s.transaction_reference?.toLowerCase()).filter(Boolean))] as string[];
  const { data: refRows } = refs.length
    ? await supabase.from("payment_submissions").select("id, order_id, transaction_reference").in("transaction_reference", subs.map((s) => s.transaction_reference!).filter(Boolean))
    : { data: [] as { id: string; order_id: string; transaction_reference: string | null }[] };
  const reused = new Set(
    refs.filter((r) => new Set((refRows ?? []).filter((x) => x.transaction_reference?.toLowerCase() === r).map((x) => x.order_id)).size > 1),
  );
  const urls = await Promise.all(subs.map(async (s) => (await supabase.storage.from("payment-receipts").createSignedUrl(s.receipt_path, 300)).data?.signedUrl ?? null));
  const canVerify = ctx.permissions.has("payments.verify");
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
          Dates in Addis Ababa time. The file contains customer contact details — store it safely. Each export is recorded in the Activity log.
        </p>
      </details>
      <nav className="mb-5 flex gap-1 border-b" aria-label="Payment status">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/payments?status=${t.key}`} aria-current={t.key === status ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm", t.key === status ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {subs.length === 0 && <p className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">No {status === "pending" ? "payments waiting for verification" : `${status} payments`}.</p>}
      <ul className="space-y-4">
        {subs.map((s, i) => {
          const order = s.order!;
          const bank = order.bank_snapshot as Record<string, string>;
          const mismatch = Number(s.amount_expected_etb) !== Number(order.total_etb);
          return (
            <li key={s.id} className="grid gap-4 rounded-xl border bg-card p-4 shadow-xs md:grid-cols-[12rem_1fr]">
              <ReceiptPreview url={urls[i]} mime={s.receipt_mime} />
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/admin/orders/${order.id}`} className="text-lg font-semibold text-primary hover:underline">{order.order_number}</Link>
                  <span className="text-xs text-muted-foreground">Submitted {formatDateTime(s.submitted_at, "en")}</span>
                </div>
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Amount to find</dt><dd className="text-base font-semibold">{formatETB(toSantim(s.amount_expected_etb))}</dd></div>
                  <div><dt className="text-muted-foreground">Into account</dt><dd>{bank.bank_name} · <span className="font-mono">{bank.account_number}</span></dd></div>
                  <div><dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{s.transaction_reference ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Customer</dt><dd>{order.customer_name} · {formatEthiopianPhone(order.customer_phone)}</dd></div>
                </dl>
                {s.transaction_reference && reused.has(s.transaction_reference.toLowerCase()) && (
                  <p className="flex items-center gap-2 rounded-md bg-destructive/5 p-2 text-destructive">
                    <AlertTriangle className="size-4" aria-hidden /> This transaction reference was also submitted for another order.
                  </p>
                )}
                {mismatch && <p className="text-amber-700">Order total changed since submission — check the amount carefully.</p>}
                {s.review_note && <p><span className="text-muted-foreground">Note:</span> {s.review_note}</p>}
                {status === "pending" && canVerify && (
                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    <ActionForm action={reviewPayment} hidden={{ submissionId: s.id, decision: "verified" }} submitLabel="Verify payment"
                      confirm={`Confirm ${formatETB(toSantim(s.amount_expected_etb))} has arrived in ${bank.bank_name} ${bank.account_number}?`} />
                    <ActionForm action={reviewPayment} hidden={{ submissionId: s.id, decision: "rejected" }} submitLabel="Reject" variant="outline">
                      <Textarea name="note" required rows={2} maxLength={1000} placeholder="Reason shown to the customer" aria-label={`Rejection reason for ${order.order_number}`} />
                    </ActionForm>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
