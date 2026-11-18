import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { adjustStock } from "@/lib/admin/catalog-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Inventory" };
const FILTERS = [{ k: "all", l: "All tracked" }, { k: "low", l: "Low & out of stock" }] as const;

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  await requirePermission("inventory.manage");
  const filter = first((await searchParams).filter) === "low" ? "low" : "all";
  const supabase = await createSupabaseServerClient();
  const [{ data: products }, { data: moves }] = await Promise.all([
    supabase.from("products").select("id, name_en, sku, stock_quantity, low_stock_threshold, status").eq("track_inventory", true).neq("status", "archived").order("stock_quantity"),
    supabase.from("inventory_movements").select("id, change, quantity_after, reason, note, created_at, order_id, product:products(name_en, sku)").order("created_at", { ascending: false }).limit(40),
  ]);
  const rows = (products ?? []).filter((p) => filter === "all" || p.stock_quantity <= p.low_stock_threshold);

  return (
    <>
      <PageHeader title="Inventory" description="Stock is reserved when an order is placed and released if it expires or is cancelled. Every change is recorded." />
      <nav className="mb-4 flex gap-1 border-b" aria-label="Inventory filter">
        {FILTERS.map((f) => (
          <Link key={f.k} href={`/admin/inventory?filter=${f.k}`} aria-current={f.k === filter ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm", f.k === filter ? "border-primary font-medium" : "border-transparent text-muted-foreground")}>{f.l}</Link>
        ))}
      </nav>
      <Table head={["Product", "In stock", "Alert at", "Adjust"]} empty="All products are well stocked.">
        {rows.map((p) => (
          <tr key={p.id}>
            <Td><span className="font-medium">{p.name_en}</span><span className="block text-xs text-muted-foreground">{p.sku}{p.status === "draft" && " · draft"}</span></Td>
            <Td>
              <span className="text-lg font-semibold tabular-nums">{p.stock_quantity}</span>{" "}
              {p.stock_quantity === 0 ? <Badge variant="destructive">Out</Badge> : p.stock_quantity <= p.low_stock_threshold && <Badge variant="warning">Low</Badge>}
            </Td>
            <Td className="tabular-nums">{p.low_stock_threshold}</Td>
            <Td>
              <ActionForm action={adjustStock} hidden={{ productId: p.id }} submitLabel="Apply" size="sm" variant="outline" resetOnSuccess className="flex flex-wrap items-center gap-2 space-y-0">
                <input name="change" type="number" required step={1} placeholder="Qty" aria-label={`Quantity for ${p.name_en}`} className={`${fieldClass} h-8 w-20`} />
                <select name="reason" className={`${fieldClass} h-8 w-auto`} aria-label="Reason">
                  <option value="restock">Restock (+)</option><option value="adjustment">Correction (±)</option>
                  <option value="damage">Damaged / lost (−)</option><option value="return">Customer return (+)</option>
                </select>
                <input name="note" maxLength={500} placeholder="Note" aria-label="Note" className={`${fieldClass} h-8 w-36`} />
              </ActionForm>
            </Td>
          </tr>
        ))}
      </Table>
      <Panel title="Recent stock movements" className="mt-6">
        <ul className="divide-y text-sm">
          {(moves ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className={cn("w-14 font-semibold tabular-nums", m.change > 0 ? "text-success" : "text-destructive")}>{m.change > 0 ? `+${m.change}` : m.change}</span>
              <span className="font-medium">{m.product?.name_en}</span>
              <span className="text-muted-foreground">{m.reason.replaceAll("_", " ")}{m.note && ` — ${m.note}`} → {m.quantity_after}</span>
              {m.order_id && <Link href={`/admin/orders/${m.order_id}`} className="text-primary hover:underline">order</Link>}
              <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.created_at, "en")}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
