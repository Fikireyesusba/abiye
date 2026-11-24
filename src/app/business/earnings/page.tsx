import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Earnings" };
const etb = (n: number | string | null | undefined) => formatETB(toSantim(Number(n ?? 0)));

/** What the shop earned (handling fee per collected order), what is still to be paid, and past payments. */
export default async function BusinessEarningsPage() {
  await requirePermission("partner.own");
  const supabase = await createSupabaseServerClient();
  // RLS: only this shop's rows.
  const [{ data: me }, { data: earnings }, { data: payouts }] = await Promise.all([
    supabase.rpc("partner_me"),
    supabase.from("partner_earnings").select("id, order_number, amount_etb, earned_at, payout_id").order("earned_at", { ascending: false }).limit(100),
    supabase.from("partner_payouts").select("id, amount_etb, orders, reference, paid_at").order("paid_at", { ascending: false }).limit(24),
  ]);
  const m = (me ?? {}) as Record<string, number | string>;
  const cards = [
    { label: "This month", value: etb(m.month_etb), hint: `${m.month_orders ?? 0} orders` },
    { label: "To be paid", value: etb(m.unpaid_etb), strong: true },
    { label: "Fee per order", value: etb(m.handling_fee_etb) },
    { label: "Orders (all time)", value: String(m.total_orders ?? 0) },
  ];
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Earnings</h1>
      <div className="grid grid-cols-2 gap-3" data-testid="business-earning-cards">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl border bg-card p-3 ${c.strong ? "border-primary/40" : ""}`}>
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-lg font-semibold tabular-nums ${c.strong ? "text-primary" : ""}`}>{c.value}</p>
            {c.hint && <p className="text-xs text-muted-foreground">{c.hint}</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">For every order a customer collects at your shop with their PIN, your shop earns the handling fee. Abiye pays you and records it here.</p>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Orders handed over</h2>
        {(earnings ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
          <ul className="divide-y rounded-xl border bg-card text-sm" data-testid="business-earnings-list">
            {(earnings ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-4 py-2">
                <span className="font-mono">{e.order_number}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(e.earned_at, "en")}</span>
                <span className="ml-auto tabular-nums">{etb(e.amount_etb)}</span>
                <span className={`w-12 text-right text-xs ${e.payout_id ? "text-success" : "text-muted-foreground"}`}>{e.payout_id ? "paid" : "unpaid"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Payments received</h2>
        {(payouts ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {(payouts ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="font-medium tabular-nums">{etb(p.amount_etb)}</span>
                <span className="text-xs text-muted-foreground">{p.orders} orders{p.reference ? ` · ref ${p.reference}` : ""}</span>
                <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(p.paid_at, "en")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
