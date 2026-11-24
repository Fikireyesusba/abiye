import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { payCourier, saveCourier } from "@/lib/admin/courier-admin-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Courier" };
const etb = (n: number | string | null | undefined) => formatETB(toSantim(Number(n ?? 0)));

/** One courier (Super Admin): details, own fee, unpaid deliveries → Mark as paid, payments, recent deliveries. */
export default async function CourierPage({ params }: PageProps<"/admin/couriers/[id]">) {
  await requirePermission("couriers.manage");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: all } = await supabase.rpc("admin_couriers");
  const c = (all ?? []).find((x) => x.id === id);
  if (!c) notFound();
  const [{ data: earnings }, { data: payouts }, { data: active }] = await Promise.all([
    supabase.from("courier_earnings").select("id, amount_etb, earned_at, payout_id, order:orders(id, order_number)").eq("courier_id", id).order("earned_at", { ascending: false }).limit(200),
    supabase.from("courier_payouts").select("id, amount_etb, deliveries, reference, note, paid_at").eq("courier_id", id).order("paid_at", { ascending: false }).limit(50),
    supabase.from("orders").select("id, order_number, status, city").eq("courier_id", id).in("status", ["confirmed", "processing", "out_for_delivery"]),
  ]);
  const unpaid = (earnings ?? []).filter((e) => !e.payout_id);
  const local = c.phone ? `0${c.phone.slice(4)}` : "";
  return (
    <>
      <Link href="/admin/couriers?tab=couriers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Couriers</Link>
      <PageHeader title={c.full_name} description={`User ID ${c.member_id ?? "—"} · ${c.email}`}
        actions={c.on_duty ? <Badge variant="success">on duty</Badge> : <Badge variant="outline">off duty</Badge>} />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title={`To pay: ${etb(c.unpaid_etb)} (${unpaid.length} deliveries)`}>
            {unpaid.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to pay.</p> : (
              <>
                <ul className="mb-4 divide-y text-sm" data-testid="unpaid-list">
                  {unpaid.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 py-1.5">
                      <Link href={`/admin/orders/${(e.order as { id?: string } | null)?.id}`} className="font-mono text-primary hover:underline">{(e.order as { order_number?: string } | null)?.order_number}</Link>
                      <span className="text-xs text-muted-foreground">{formatDateTime(e.earned_at, "en")}</span>
                      <span className="ml-auto tabular-nums">{etb(e.amount_etb)}</span>
                    </li>
                  ))}
                </ul>
                <ActionForm action={payCourier} hidden={{ courierId: id }} submitLabel={`Mark ${etb(c.unpaid_etb)} as paid`} confirm={`Record that you paid ${c.full_name} ${etb(c.unpaid_etb)}?`} className="grid gap-2 sm:grid-cols-2">
                  <input name="reference" maxLength={80} placeholder="Reference (e.g. transfer number) — optional" aria-label="Payment reference" className={fieldClass} />
                  <input name="note" maxLength={300} placeholder="Note — optional" aria-label="Payment note" className={fieldClass} />
                </ActionForm>
              </>
            )}
          </Panel>
          <Panel title="Payments">
            <Table head={["Paid", "Amount", "Deliveries", "Reference", "Note"]} empty="No payments yet.">
              {(payouts ?? []).map((p) => (
                <tr key={p.id}><Td className="text-xs">{formatDateTime(p.paid_at, "en")}</Td><Td className="tabular-nums">{etb(p.amount_etb)}</Td><Td>{p.deliveries}</Td><Td className="font-mono text-xs">{p.reference ?? "—"}</Td><Td className="text-xs">{p.note ?? "—"}</Td></tr>
              ))}
            </Table>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Now">
            {(active ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No active deliveries.</p> : (
              <ul className="space-y-1 text-sm">{(active ?? []).map((o) => <li key={o.id}><Link href={`/admin/orders/${o.id}`} className="font-mono text-primary hover:underline">{o.order_number}</Link> <span className="text-xs text-muted-foreground">{o.status.replaceAll("_", " ")} · {o.city}</span></li>)}</ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{c.delivered_month} delivered this month · {c.delivered_total} in total{c.failed_month ? ` · ${c.failed_month} failed this month` : ""}</p>
          </Panel>
          <Panel title="Details">
            <ActionForm action={saveCourier} hidden={{ courierId: id }} submitLabel="Save" className="space-y-3">
              <Field label="Phone"><input name="phone" inputMode="tel" defaultValue={local} placeholder="0911223344" className={fieldClass} /></Field>
              <Field label="Vehicle">
                <select name="vehicle" defaultValue={c.vehicle} className={fieldClass}>
                  <option value="motorbike">Motorbike</option><option value="bicycle">Bicycle</option><option value="car">Car</option><option value="on_foot">On foot</option><option value="other">Other</option>
                </select>
              </Field>
              <Field label="Plate number"><input name="plate" maxLength={20} defaultValue={c.plate_number ?? ""} className={`${fieldClass} uppercase`} /></Field>
              <Field label="Own fee per delivery (ETB)" hint={`Empty = the shop's fee. Now: ${etb(c.fee_etb)}.`}>
                <input name="fee" type="number" min={0} step="0.01" defaultValue={c.fee_override_etb ?? ""} className={fieldClass} />
              </Field>
            </ActionForm>
            <p className="mt-3 text-xs text-muted-foreground">Name, email, password and two-step login: Staff.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
