import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { PageHeader, SubTabs, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserIdLink } from "@/components/admin/user-id";
import { memberIds } from "@/lib/admin/member-ids";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
      <SubTabs base="/admin/wallet" tabs={TABS} active={tab} />
      {tab === "balances" ? <Balances q={q} /> : <Topups status={tab} />}
    </>
  );

  async function Balances({ q }: { q: string }) {
    const { data } = await supabase.rpc("admin_wallet_balances", { p_search: q || undefined, p_limit: 200 });
    const total = (data ?? []).reduce((s, r) => s + Number(r.balance_etb), 0);
    const ids = await memberIds((data ?? []).map((r) => r.user_id));
    return (
      <>
        <form method="get" className="mb-4 flex gap-2">
          <input type="hidden" name="tab" value="balances" />
          <input name="q" defaultValue={q} placeholder="Email or name" maxLength={60} className={`${fieldClass} max-w-xs`} aria-label="Search customers" />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <p className="mb-3 text-sm text-muted-foreground">Total customer balances (money you owe as shop credit): <strong className="text-foreground">{etb(total)}</strong></p>
        <Table scroll head={["User ID", "Balance", "Last activity"]} empty="No customer balances yet.">
          {(data ?? []).map((r) => (
            <tr key={r.user_id}>
              <Td><UserIdLink id={ids.get(r.user_id)} /></Td>
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
      .select("id, topup_number, receipt_sha256, created_at, reviewed_at")
      .eq("status", status).order("created_at", { ascending: status === "pending" }).limit(200);
    const list = rows ?? [];
    // Flag a receipt file that was also sent with another top-up.
    const { data: refs } = list.length
      ? await supabase.from("wallet_topups").select("id, receipt_sha256").in("receipt_sha256", [...new Set(list.map((r) => r.receipt_sha256))])
      : { data: [] as { id: string; receipt_sha256: string }[] };
    const dupReceipt = (r: (typeof list)[number]) => (refs ?? []).some((x) => x.id !== r.id && x.receipt_sha256 === r.receipt_sha256);
    return (
      <Table scroll head={["Top-up", "Sent", status === "pending" ? "Checks" : "Decided"]}
        empty={status === "pending" ? "No top-ups waiting for verification." : `No ${status} top-ups.`}>
        {list.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/admin/wallet/${r.id}`} className="font-mono font-semibold text-primary underline-offset-2 hover:underline">{r.topup_number}</Link></Td>
            <Td className="text-xs text-muted-foreground">{formatDateTime(r.created_at, "en")}</Td>
            <Td>
              {status === "pending"
                ? (dupReceipt(r) ? <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="size-3.5" aria-hidden /> Check carefully</span> : <span className="text-xs text-muted-foreground">—</span>)
                : <Badge variant={status === "verified" ? "success" : "destructive"}>{status}{r.reviewed_at ? ` ${formatDateTime(r.reviewed_at, "en")}` : ""}</Badge>}
            </Td>
          </tr>
        ))}
      </Table>
    );
  }
}
