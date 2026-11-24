import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { payPartner } from "@/lib/admin/partner-admin-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ShopForm } from "../shop-form";

export const metadata: Metadata = { title: "Partner shop" };
const etb = (n: number | string | null | undefined) => formatETB(toSantim(Number(n ?? 0)));

/** One partner shop (Super Admin): details, open orders, unpaid handling fees → Mark as paid, payments. */
export default async function PartnerShopPage({ params, searchParams }: PageProps<"/admin/partners/[id]">) {
  await requirePermission("partners.manage");
  const { id } = await params;
  const created = (await searchParams).created === "1";
  const supabase = await createSupabaseServerClient();
  const { data: all } = await supabase.rpc("admin_partner_shops");
  const s = (all ?? []).find((x) => x.id === id);
  if (!s) notFound();
  const [{ data: earnings }, { data: payouts }, { data: open }, { data: zones }] = await Promise.all([
    supabase.from("partner_earnings").select("id, order_id, order_number, amount_etb, earned_at, payout_id").eq("shop_id", id).order("earned_at", { ascending: false }).limit(200),
    supabase.from("partner_payouts").select("id, amount_etb, orders, reference, note, paid_at").eq("shop_id", id).order("paid_at", { ascending: false }).limit(50),
    supabase.from("orders").select("id, order_number, status, at_shop_at").eq("partner_shop_id", id).eq("payment_status", "verified")
      .in("status", ["confirmed", "processing", "out_for_delivery", "ready_for_pickup"]).order("created_at"),
    supabase.from("delivery_zones").select("id, name_en, is_active, fee_etb").order("is_active", { ascending: false }).order("name_en"),
  ]);
  const unpaid = (earnings ?? []).filter((e) => !e.payout_id);
  const STAGE: Record<string, string> = { confirmed: "paid", processing: "being prepared", out_for_delivery: "courier on the way", ready_for_pickup: "at the shop" };
  return (
    <>
      <Link href="/admin/partners" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Partner shops</Link>
      <PageHeader title={s.name} description={`${s.city} · ${s.address_line}${s.staff ? ` · staff: ${s.staff}` : ""}`}
        actions={s.is_active ? <Badge variant="success">open</Badge> : <Badge variant="secondary">closed</Badge>} />
      {created && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm" role="status">Shop added. Now link its staff under Partner shops → Shop staff.</p>}
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <Panel title={`To pay: ${etb(s.unpaid_etb)} (${unpaid.length} orders)`}>
            {unpaid.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to pay.</p> : (
              <>
                <ul className="mb-4 divide-y text-sm" data-testid="partner-unpaid">
                  {unpaid.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 py-1.5">
                      <Link href={`/admin/orders/${e.order_id}`} className="font-mono text-primary hover:underline">{e.order_number}</Link>
                      <span className="text-xs text-muted-foreground">{formatDateTime(e.earned_at, "en")}</span>
                      <span className="ml-auto tabular-nums">{etb(e.amount_etb)}</span>
                    </li>
                  ))}
                </ul>
                <ActionForm action={payPartner} hidden={{ shopId: id }} submitLabel={`Mark ${etb(s.unpaid_etb)} as paid`} confirm={`Record that you paid ${s.name} ${etb(s.unpaid_etb)}?`} className="grid gap-2 sm:grid-cols-2">
                  <input name="reference" maxLength={80} placeholder="Reference (e.g. transfer number) — optional" aria-label="Payment reference" className={fieldClass} />
                  <input name="note" maxLength={300} placeholder="Note — optional" aria-label="Payment note" className={fieldClass} />
                </ActionForm>
              </>
            )}
          </Panel>
          <Panel title="Open orders for this shop">
            {(open ?? []).length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
              <ul className="divide-y text-sm">
                {(open ?? []).map((o) => (
                  <li key={o.id} className="flex items-center gap-2 py-1.5">
                    <Link href={`/admin/orders/${o.id}`} className="font-mono text-primary hover:underline">{o.order_number}</Link>
                    <span className="text-muted-foreground">{STAGE[o.status] ?? o.status}</span>
                    {o.at_shop_at && <span className="ml-auto text-xs text-muted-foreground">since {formatDateTime(o.at_shop_at, "en")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Payments">
            <Table head={["Paid", "Amount", "Orders", "Reference", "Note"]} empty="No payments yet.">
              {(payouts ?? []).map((p) => (
                <tr key={p.id}>
                  <Td className="text-xs">{formatDateTime(p.paid_at, "en")}</Td>
                  <Td className="tabular-nums">{etb(p.amount_etb)}</Td>
                  <Td className="tabular-nums">{p.orders}</Td>
                  <Td>{p.reference ?? "—"}</Td>
                  <Td className="text-xs">{p.note ?? ""}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
        <Panel title="Shop details">
          <ShopForm shop={{ ...s, handling_fee_etb: s.handling_fee_etb === null ? 0 : Number(s.handling_fee_etb) }}
            zones={(zones ?? []).map((z) => ({ ...z, fee_etb: Number(z.fee_etb) }))} />
        </Panel>
      </div>
    </>
  );
}
