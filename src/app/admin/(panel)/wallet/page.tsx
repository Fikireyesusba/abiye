import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Download } from "lucide-react";
import { PageHeader, SubTabs, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserIdLink } from "@/components/admin/user-id";
import { memberIds } from "@/lib/admin/member-ids";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime, zoneToday } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Wallet" };
const TABS = [{ key: "pending", label: "To verify" }, { key: "verified", label: "Verified" }, { key: "rejected", label: "Rejected" }, { key: "balances", label: "Balances" }] as const;
const etb = (n: number | string | null) => formatETB(toSantim(Number(n ?? 0)));

export default async function WalletAdminPage({ searchParams }: PageProps<"/admin/wallet">) {
  const ctx = await requirePermission("wallet.manage");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === first(sp.tab))?.key ?? "pending";
  const q = (first(sp.q) ?? "").trim().slice(0, 60);
  const supabase = await createSupabaseServerClient();

  return (
    <>
      <PageHeader title="Wallet" description="Customer shop credit (max 10,000 ETB each). Verify a top-up only after you see the money in the bank account." />
      <SubTabs base="/admin/wallet" tabs={TABS} active={tab} />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2" data-testid="wallet-search">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={q} placeholder={tab === "balances" ? "User ID, email or name" : "User ID, top-up number or reference"} maxLength={60}
          className={`${fieldClass} max-w-xs`} aria-label="Search the wallet" />
        <Button type="submit" variant="outline">Search</Button>
        {q && <Button asChild variant="ghost"><Link href={`/admin/wallet?tab=${tab}`}>Clear</Link></Button>}
        {ctx.role === "super_admin" && (
          <Button asChild variant="outline" className="ml-auto">
            <a href={`/admin/exports/download?${new URLSearchParams({ kind: "wallet", from: `${zoneToday().slice(0, 7)}-01`, to: zoneToday() })}`} data-testid="wallet-export"><Download /> Excel</a>
          </Button>
        )}
      </form>
      {tab === "balances" ? <Balances q={q} /> : <Topups status={tab} q={q} />}
    </>
  );

  async function Balances({ q }: { q: string }) {
    const { data } = await supabase.rpc("admin_wallet_balances", { p_search: q || undefined, p_limit: 200 });
    const total = (data ?? []).reduce((s, r) => s + Number(r.balance_etb), 0);
    const ids = await memberIds((data ?? []).map((r) => r.user_id));
    return (
      <>
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

  async function Topups({ status, q }: { status: "pending" | "verified" | "rejected"; q: string }) {
    let query = supabase.from("wallet_topups")
      .select("id, topup_number, receipt_sha256, created_at, reviewed_at, amount_etb, user_id")
      .eq("status", status).order("created_at", { ascending: status === "pending" }).limit(200);
    if (/^[1-9][0-9]{5}$/.test(q)) {
      // A User ID: that customer's top-ups.
      const { data: who } = await supabase.from("customer_accounts").select("id").eq("member_id", q).maybeSingle();
      query = query.eq("user_id", who?.id ?? "00000000-0000-0000-0000-000000000000");
    } else if (q) {
      const like = `%${q.replace(/[%_,()]/g, "")}%`;
      query = query.or(`topup_number.ilike.${like},transaction_reference.ilike.${like}`);
    }
    const { data: rows } = await query;
    const ids = await memberIds((rows ?? []).map((r) => r.user_id));
    const list = rows ?? [];
    // Flag a receipt file that was also sent with another top-up.
    const { data: refs } = list.length
      ? await supabase.from("wallet_topups").select("id, receipt_sha256").in("receipt_sha256", [...new Set(list.map((r) => r.receipt_sha256))])
      : { data: [] as { id: string; receipt_sha256: string }[] };
    const dupReceipt = (r: (typeof list)[number]) => (refs ?? []).some((x) => x.id !== r.id && x.receipt_sha256 === r.receipt_sha256);
    return (
      <Table scroll head={["Top-up", "User ID", "Amount", "Sent", status === "pending" ? "Checks" : "Decided"]}
        empty={status === "pending" ? "No top-ups waiting for verification." : `No ${status} top-ups.`}>
        {list.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/admin/wallet/${r.id}`} className="font-mono font-semibold text-primary underline-offset-2 hover:underline">{r.topup_number}</Link></Td>
            <Td><UserIdLink id={ids.get(r.user_id)} /></Td>
            <Td className="tabular-nums">{etb(r.amount_etb)}</Td>
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
