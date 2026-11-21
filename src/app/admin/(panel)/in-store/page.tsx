import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { InStoreSaleForm } from "@/components/admin/instore-sale-form";
import { PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { voidInStoreSale } from "@/lib/admin/instore-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "In-store sales" };
const METHOD: Record<string, string> = { cash: "Cash", mobile_money: "Mobile money", bank_transfer: "Bank transfer" };

/** Sales made at the shop counter (without the app): recorded here so stock, orders and reports stay complete. */
export default async function InStorePage({ searchParams }: PageProps<"/admin/in-store">) {
  await requirePermission("orders.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: products }, { data: sales }] = await Promise.all([
    supabase.from("products").select("id, name_en, sku, effective_price_etb, stock_quantity, track_inventory").neq("status", "archived").order("name_en"),
    supabase.from("orders").select("id, order_number, total_etb, discount_etb, payment_method, status, customer_name, created_at, items:order_items(name_en, quantity)")
      .eq("channel", "in_store").order("created_at", { ascending: false }).limit(200),
  ]);
  const TABS = [{ key: "new", label: "New sale" }, { key: "sales", label: "In-store sales", count: (sales ?? []).length }];
  const tab = pickTab(TABS, (await searchParams).tab);
  const etb = (n: number | string) => formatETB(toSantim(Number(n)));
  return (
    <>
      <PageHeader title="In-store sales" description="Record products sold at the shop (not through the app). Stock, Orders, Analytics and Sales reports then include them." />
      <SubTabs base="/admin/in-store" tabs={TABS} active={tab} />
      {tab === "new" && (
        <Panel title="New sale" className="max-w-4xl">
          <InStoreSaleForm products={(products ?? []).map((p) => ({ id: p.id, name: p.name_en, sku: p.sku, price: Number(p.effective_price_etb ?? 0), stock: p.track_inventory ? p.stock_quantity : null }))} />
        </Panel>
      )}
      {tab === "sales" && (
        <Table scroll head={["Sale", "Items", "Total", "Paid by", "Status", "When", ""]} empty="No in-store sales yet.">
          {(sales ?? []).map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/admin/orders/${s.id}`} className="font-medium text-primary hover:underline">{s.order_number}</Link><span className="block text-xs text-muted-foreground">{s.customer_name}</span></Td>
              <Td className="text-xs">{(s.items ?? []).map((i) => `${i.quantity} × ${i.name_en}`).join(", ")}</Td>
              <Td className="tabular-nums">{etb(s.total_etb)}{Number(s.discount_etb) > 0 && <span className="block text-xs text-muted-foreground">−{etb(s.discount_etb)} discount</span>}</Td>
              <Td className="text-sm">{METHOD[s.payment_method] ?? s.payment_method}</Td>
              <Td>{s.status === "cancelled" ? <StatusBadge kind="order" status="cancelled" /> : <StatusBadge kind="order" status="completed" />}</Td>
              <Td className="text-xs text-muted-foreground">{formatDateTime(s.created_at, "en")}</Td>
              <Td>
                {s.status !== "cancelled" && (
                  <ActionForm action={voidInStoreSale} hidden={{ orderId: s.id }} submitLabel="Void" size="sm" variant="outline" className="flex items-end gap-2 space-y-0"
                    confirm={`Void ${s.order_number}? Its stock comes back and it leaves the sales figures.`}>
                    <input name="reason" required minLength={2} maxLength={500} placeholder="Reason" aria-label={`Reason for voiding ${s.order_number}`} className={`${fieldClass} h-8 w-32`} />
                  </ActionForm>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
