import type { Metadata } from "next";
import { ScanStatus } from "@/components/admin/scan-status";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { ReceiptPreview } from "@/components/admin/receipt-preview";
import { PageHeader } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { reviewPayment } from "@/lib/admin/order-actions";
import { requirePermission } from "@/lib/auth/guards";
import { isGuid } from "@/lib/orders/access";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Payment" };

/** One payment submission: the receipt, every detail, and the verify / reject buttons. */
export default async function PaymentDetailPage({ params }: PageProps<"/admin/payments/[id]">) {
  const ctx = await requirePermission("payments.view");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: s } = await supabase
    .from("payment_submissions")
    .select("*, order:orders(id, order_number, customer_name, customer_phone, total_etb, status, bank_snapshot)")
    .eq("id", id)
    .maybeSingle();
  if (!s?.order) notFound();
  const order = s.order;
  const bank = (order.bank_snapshot ?? {}) as Record<string, string>;
  const [{ data: url }, { data: same }] = await Promise.all([
    supabase.storage.from("payment-receipts").createSignedUrl(s.receipt_path, 300),
    s.transaction_reference
      ? supabase.from("payment_submissions").select("order_id, transaction_reference").ilike("transaction_reference", s.transaction_reference.replace(/[%_\\]/g, "\\$&"))
      : Promise.resolve({ data: [] as { order_id: string; transaction_reference: string | null }[] }),
  ]);
  const reused = new Set((same ?? []).map((x) => x.order_id)).size > 1;
  const mismatch = Number(s.amount_expected_etb) !== Number(order.total_etb);
  const canVerify = ctx.permissions.has("payments.verify");
  const back = `/admin/payments?status=${s.status}`;

  return (
    <>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> All {s.status} payments</Link>
      <PageHeader title={`Payment for ${order.order_number}`} description="Check the transfer in the bank account before verifying. A screenshot alone is not proof of payment." />
      <div className="grid gap-6 rounded-xl border bg-card p-4 shadow-xs md:grid-cols-[minmax(14rem,22rem)_1fr]">
        <ReceiptPreview url={url?.signedUrl ?? null} mime={s.receipt_mime} />
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/admin/orders/${order.id}`} className="text-lg font-semibold text-primary hover:underline">Order {order.order_number}</Link>
            <span className="text-xs text-muted-foreground">Submitted {formatDateTime(s.submitted_at, "en")}</span>
          </div>
          <ScanStatus sha256={s.receipt_sha256} />
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Amount to find</dt><dd className="text-base font-semibold">{formatETB(toSantim(s.amount_expected_etb))}</dd></div>
            <div><dt className="text-muted-foreground">Into account</dt><dd>{bank.bank_name ?? "—"} · <span className="font-mono">{bank.account_number ?? ""}</span></dd></div>
            <div><dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{s.transaction_reference ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Customer</dt><dd>{order.customer_name} · {formatEthiopianPhone(order.customer_phone)}</dd></div>
          </dl>
          {reused && (
            <p className="flex items-center gap-2 rounded-md bg-destructive/5 p-2 text-destructive">
              <AlertTriangle className="size-4" aria-hidden /> This transaction reference was also submitted for another order.
            </p>
          )}
          {mismatch && <p className="text-amber-700">Order total changed since submission — check the amount carefully.</p>}
          {s.review_note && <p><span className="text-muted-foreground">Note:</span> {s.review_note}</p>}
          {s.status !== "pending" && <Badge variant={s.status === "verified" ? "success" : "destructive"}>{s.status} {s.reviewed_at ? formatDateTime(s.reviewed_at, "en") : ""}</Badge>}
          {s.status === "pending" && canVerify && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <ActionForm action={reviewPayment} hidden={{ submissionId: s.id, decision: "verified" }} submitLabel="Verify payment"
                confirm={`Confirm ${formatETB(toSantim(s.amount_expected_etb))} has arrived in ${bank.bank_name ?? "your bank account"} ${bank.account_number ?? ""}?`} />
              <ActionForm action={reviewPayment} hidden={{ submissionId: s.id, decision: "rejected" }} submitLabel="Reject" variant="outline">
                <Textarea name="note" required rows={2} maxLength={1000} placeholder="Reason shown to the customer" aria-label={`Rejection reason for ${order.order_number}`} />
              </ActionForm>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
