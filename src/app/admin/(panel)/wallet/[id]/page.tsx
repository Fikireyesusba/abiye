import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { ReceiptPreview } from "@/components/admin/receipt-preview";
import { PageHeader } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { reviewTopup } from "@/lib/admin/wallet-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { isGuid } from "@/lib/orders/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Top-up" };
const etb = (n: number | string | null) => formatETB(toSantim(Number(n ?? 0)));

/** One wallet top-up: the receipt, every detail, and the verify / reject buttons. */
export default async function TopupDetailPage({ params }: PageProps<"/admin/wallet/[id]">) {
  await requirePermission("wallet.manage");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: r } = await supabase.from("wallet_topups")
    .select("id, topup_number, user_id, amount_etb, transaction_reference, receipt_path, receipt_mime, receipt_sha256, bank_snapshot, status, review_note, created_at, reviewed_at")
    .eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: url }, { data: people }, { count: sameReceipt }] = await Promise.all([
    supabase.storage.from("payment-receipts").createSignedUrl(r.receipt_path, 300),
    supabase.rpc("admin_customer_accounts", { p_user_id: r.user_id, p_limit: 1 }),
    supabase.from("wallet_topups").select("id", { count: "exact", head: true }).eq("receipt_sha256", r.receipt_sha256).neq("id", r.id),
  ]);
  const c = people?.[0];
  const bank = (r.bank_snapshot ?? {}) as Record<string, string>;

  return (
    <>
      <Link href={`/admin/wallet?tab=${r.status}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> All {r.status === "pending" ? "top-ups to verify" : `${r.status} top-ups`}</Link>
      <PageHeader title={`Top-up ${r.topup_number}`} description="Verify a top-up only after you see the money in the bank account." />
      <div className="grid gap-6 rounded-xl border bg-card p-4 shadow-xs md:grid-cols-[minmax(14rem,22rem)_1fr]">
        <ReceiptPreview url={url?.signedUrl ?? null} mime={r.receipt_mime} />
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-lg font-semibold">{r.topup_number}</span>
            <span className="text-xs text-muted-foreground">Sent {formatDateTime(r.created_at, "en")}</span>
          </div>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Amount to find</dt><dd className="text-base font-semibold">{etb(r.amount_etb)}</dd></div>
            <div><dt className="text-muted-foreground">Into account</dt><dd>{bank.bank_name ?? "—"} · <span className="font-mono">{bank.account_number ?? ""}</span></dd></div>
            <div><dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{r.transaction_reference ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Customer</dt><dd>
              <Link href={`/admin/customers/${r.user_id}`} className="text-primary underline underline-offset-2">{c?.full_name || c?.email || "Customer"}</Link>
              {c?.email && <span className="block text-xs text-muted-foreground">{c.email}</span>}
            </dd></div>
          </dl>
          {!!sameReceipt && (
            <p className="flex items-center gap-2 rounded-md bg-destructive/5 p-2 text-destructive"><AlertTriangle className="size-4" aria-hidden /> The same receipt file was sent in another top-up.</p>
          )}
          {r.review_note && <p><span className="text-muted-foreground">Note:</span> {r.review_note}</p>}
          {r.status !== "pending" && <Badge variant={r.status === "verified" ? "success" : "destructive"}>{r.status} {r.reviewed_at ? formatDateTime(r.reviewed_at, "en") : ""}</Badge>}
          {r.status === "pending" && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <ActionForm action={reviewTopup} hidden={{ topupId: r.id, decision: "verified" }} submitLabel="Verify and add to balance"
                confirm={`Confirm ${etb(r.amount_etb)} has arrived in ${bank.bank_name ?? "your bank account"} ${bank.account_number ?? ""}?`} />
              <ActionForm action={reviewTopup} hidden={{ topupId: r.id, decision: "rejected" }} submitLabel="Reject" variant="outline">
                <Textarea name="note" required rows={2} maxLength={1000} placeholder="Reason shown to the customer" aria-label={`Rejection reason for ${r.topup_number}`} />
              </ActionForm>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
