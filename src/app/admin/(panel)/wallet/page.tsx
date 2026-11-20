import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { ReceiptPreview } from "@/components/admin/receipt-preview";
import { PageHeader, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reviewTopup } from "@/lib/admin/wallet-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Wallet" };
const TABS = [{ key: "pending", label: "To verify" }, { key: "verified", label: "Verified" }, { key: "rejected", label: "Rejected" }, { key: "balances", label: "Balances" }] as const;
const etb = (n: number | string | null) => formatETB(toSantim(Number(n ?? 0)));

export default async function WalletAdminPage({ searchParams }: PageProps<"/admin/wallet">) {
  await requirePermission("wallet.manage");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === first(sp.tab))?.key ?? "pending";
  const q = (first(sp.q) ?? "").trim().slice(0, 60);
  const supabase = await createSupabaseServerClient();

  return (
    <>
      <PageHeader title="Wallet" description="Customer shop credit (max 10,000 ETB each). Verify a top-up only after you see the money in the bank account." />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b" aria-label="Wallet sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/wallet?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm whitespace-nowrap", t.key === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "balances" ? <Balances q={q} /> : <Topups status={tab} />}
    </>
  );

  async function Balances({ q }: { q: string }) {
    const { data } = await supabase.rpc("admin_wallet_balances", { p_search: q || undefined, p_limit: 200 });
    const total = (data ?? []).reduce((s, r) => s + Number(r.balance_etb), 0);
    return (
      <>
        <form method="get" className="mb-4 flex gap-2">
          <input type="hidden" name="tab" value="balances" />
          <input name="q" defaultValue={q} placeholder="Email or name" maxLength={60} className={`${fieldClass} max-w-xs`} aria-label="Search customers" />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <p className="mb-3 text-sm text-muted-foreground">Total customer balances (money you owe as shop credit): <strong className="text-foreground">{etb(total)}</strong></p>
        <Table scroll head={["Customer", "Balance", "Last activity"]} empty="No customer balances yet.">
          {(data ?? []).map((r) => (
            <tr key={r.user_id}>
              <Td><Link href={`/admin/customers/${r.user_id}`} className="font-medium text-primary underline underline-offset-2">{r.full_name || r.email}</Link><span className="block text-xs text-muted-foreground">{r.email}</span></Td>
              <Td className="tabular-nums">{etb(r.balance_etb)}</Td>
              <Td className="text-xs text-muted-foreground">{r.last_activity ? formatDateTime(r.last_activity, "en") : "—"}</Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }

  async function Topups({ status }: { status: "pending" | "verified" | "rejected" }) {
    const { data: rows } = await supabase.from("wallet_topups")
      .select("id, topup_number, user_id, amount_etb, transaction_reference, receipt_path, receipt_mime, receipt_sha256, bank_snapshot, status, review_note, created_at, reviewed_at")
      .eq("status", status).order("created_at", { ascending: status === "pending" }).limit(100);
    const list = rows ?? [];
    const ids = [...new Set(list.map((r) => r.user_id))];
    const [{ data: people }, urls, { data: refs }] = await Promise.all([
      // Only the customers on this page (one lookup each; at most 100).
      Promise.all(ids.map((uid) => supabase.rpc("admin_customer_accounts", { p_user_id: uid, p_limit: 1 }).then((r) => r.data?.[0] ?? null)))
        .then((r) => ({ data: r.filter((x): x is NonNullable<typeof x> => !!x) })),
      Promise.all(list.map(async (r) => (await supabase.storage.from("payment-receipts").createSignedUrl(r.receipt_path, 300)).data?.signedUrl ?? null)),
      list.length ? supabase.from("wallet_topups").select("id, transaction_reference, receipt_sha256").or(
        list.map((r) => `receipt_sha256.eq.${r.receipt_sha256}`).join(",")) : Promise.resolve({ data: [] as { id: string; transaction_reference: string | null; receipt_sha256: string }[] }),
    ]);
    const person = new Map((people ?? []).map((p) => [p.id, p]));
    const dupReceipt = (r: (typeof list)[number]) => (refs ?? []).some((x) => x.id !== r.id && x.receipt_sha256 === r.receipt_sha256);
    if (!list.length) return <p className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">No {status === "pending" ? "top-ups waiting for verification" : `${status} top-ups`}.</p>;
    return (
      <ul className="space-y-4">
        {list.map((r, i) => {
          const c = person.get(r.user_id);
          const bank = (r.bank_snapshot ?? {}) as Record<string, string>;
          return (
            <li key={r.id} className="grid gap-4 rounded-xl border bg-card p-4 shadow-xs md:grid-cols-[12rem_1fr]">
              <ReceiptPreview url={urls[i]} mime={r.receipt_mime} />
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold">{r.topup_number}</span>
                  <span className="text-xs text-muted-foreground">Sent {formatDateTime(r.created_at, "en")}</span>
                </div>
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Amount to find</dt><dd className="text-base font-semibold">{etb(r.amount_etb)}</dd></div>
                  <div><dt className="text-muted-foreground">Into account</dt><dd>{bank.bank_name ?? "—"} · <span className="font-mono">{bank.account_number ?? ""}</span></dd></div>
                  <div><dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{r.transaction_reference ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Customer</dt><dd>
                    <Link href={`/admin/customers/${r.user_id}`} className="text-primary underline underline-offset-2">{c?.full_name || c?.email || "Customer"}</Link>
                    {c?.email && <span className="block text-xs text-muted-foreground">{c.email}</span>}
                  </dd></div>
                </dl>
                {dupReceipt(r) && (
                  <p className="flex items-center gap-2 rounded-md bg-destructive/5 p-2 text-destructive"><AlertTriangle className="size-4" aria-hidden /> The same receipt file was sent in another top-up.</p>
                )}
                {r.review_note && <p><span className="text-muted-foreground">Note:</span> {r.review_note}</p>}
                {status !== "pending" && <Badge variant={status === "verified" ? "success" : "destructive"}>{status} {r.reviewed_at ? formatDateTime(r.reviewed_at, "en") : ""}</Badge>}
                {status === "pending" && (
                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    <ActionForm action={reviewTopup} hidden={{ topupId: r.id, decision: "verified" }} submitLabel="Verify and add to balance"
                      confirm={`Confirm ${etb(r.amount_etb)} has arrived in ${bank.bank_name ?? "your bank account"} ${bank.account_number ?? ""}?`} />
                    <ActionForm action={reviewTopup} hidden={{ topupId: r.id, decision: "rejected" }} submitLabel="Reject" variant="outline">
                      <Textarea name="note" required rows={2} maxLength={1000} placeholder="Reason shown to the customer" aria-label={`Rejection reason for ${r.topup_number}`} />
                    </ActionForm>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
}
