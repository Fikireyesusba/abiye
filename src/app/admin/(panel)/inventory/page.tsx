import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Searchable } from "@/components/admin/searchable";
import { PageHeader, Table, Td, fieldClass } from "@/components/admin/ui";
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
  const [{ data: products }, { data: moves }, { data: waitingRows }] = await Promise.all([
    supabase.from("products").select("id, name_en, sku, stock_quantity, low_stock_threshold, status").eq("track_inventory", true).neq("status", "archived").order("stock_quantity"),
    supabase.from("inventory_movements").select("id, change, quantity_after, reason, note, created_at, order_id, product:products(name_en, sku)").order("created_at", { ascending: false }).limit(40),
    // Customers waiting for "back in stock" emails (open requests).
    supabase.from("stock_alerts").select("product_id").is("notified_at", null).limit(5000),
  ]);
  const waiting = new Map<string, number>();
  for (const w of waitingRows ?? []) waiting.set(w.product_id, (waiting.get(w.product_id) ?? 0) + 1);
  const rows = (products ?? []).filter((p) => filter === "all" || p.stock_quantity <= p.low_stock_threshold);

  return (
    <>
      <PageHeader title="Inventory" description="Stock is reserved when an order is placed and released if it expires or is cancelled. Every change is recorded. Staff who manage stock get an alert when a product reaches its alert level or sells out; customers waiting for a sold-out product are told automatically when you restock it." />
      <nav className="mb-4 flex gap-1 border-b" aria-label="Inventory filter">
        {FILTERS.map((f) => (
          <Link key={f.k} href={`/admin/inventory?filter=${f.k}`} aria-current={f.k === filter ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm", f.k === filter ? "border-primary font-medium" : "border-transparent text-muted-foreground")}>{f.l}</Link>
        ))}
      </nav>
      <Table scroll head={["Product", "In stock", "Alert at", "Adjust"]} empty="All products are well stocked.">
        {rows.map((p) => (
          <tr key={p.id}>
            <Td><span className="font-medium">{p.name_en}</span><span className="block text-xs text-muted-foreground">{p.sku}{p.status === "draft" && " · draft"}</span></Td>
            <Td>
              <span className="text-lg font-semibold tabular-nums">{p.stock_quantity}</span>{" "}
              {p.stock_quantity === 0 ? <Badge variant="destructive">Out</Badge> : p.stock_quantity <= p.low_stock_threshold && <Badge variant="warning">Low</Badge>}
              {(waiting.get(p.id) ?? 0) > 0 && <span className="block text-xs text-muted-foreground">{waiting.get(p.id)} customer{waiting.get(p.id) === 1 ? "" : "s"} waiting</span>}
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
      <details className="mt-6 rounded-lg border bg-card" data-testid="stock-movements">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-4">
          <span className="font-medium">Recent stock movements</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{(moves ?? []).length}</span>
          <span className="text-xs text-muted-foreground sm:ml-auto">Latest 40 changes · click to open</span>
        </summary>
        <Searchable className="border-t p-3" placeholder="Search movements (product, reason, note)…">
        <ul className="max-h-[60vh] divide-y overflow-y-auto overscroll-contain px-1 text-sm">
          {(moves ?? []).length === 0 && <li className="py-3 text-muted-foreground">No stock changes yet.</li>}
          {(moves ?? []).map((m) => (
            <li key={m.id} data-row className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[3.5rem_1fr_auto]">
              <span className={cn("font-semibold tabular-nums", m.change > 0 ? "text-success" : "text-destructive")}>{m.change > 0 ? `+${m.change}` : m.change}</span>
              <span className="min-w-0 break-words">
                <span className="font-medium">{m.product?.name_en}</span>
                <span className="block text-muted-foreground">
                  {m.reason.replaceAll("_", " ")}{m.note && ` — ${m.note}`} → {m.quantity_after} in stock
                  {m.order_id && <> · <Link href={`/admin/orders/${m.order_id}`} className="text-primary hover:underline">order</Link></>}
                </span>
              </span>
              <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-right">{formatDateTime(m.created_at, "en")}</span>
            </li>
          ))}
        </ul>
        </Searchable>
      </details>
    </>
  );
}
