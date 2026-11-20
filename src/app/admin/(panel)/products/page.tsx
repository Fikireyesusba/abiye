import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guards";
import { first, sanitizeSearchTerm } from "@/lib/catalog/search";
import { formatETB, toSantim } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const ctx = await requirePermission("products.view");
  const sp = await searchParams;
  const q = sanitizeSearchTerm(first(sp.q));
  const status = ["draft", "active", "archived"].find((s) => s === first(sp.status)) as "draft" | "active" | "archived" | undefined;
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("products")
    .select("id, name_en, sku, price_etb, sale_price_etb, stock_quantity, low_stock_threshold, track_inventory, status, is_featured, category:categories(name_en), images:product_images(storage_path, is_primary)")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  else query = query.neq("status", "archived");
  if (q) query = query.or(`name_en.ilike.*${q}*,name_am.ilike.*${q}*,sku.ilike.*${q}*`);
  const { data: products, error } = await query;
  if (error) throw new Error("Could not load products");

  return (
    <>
      <PageHeader title="Products" description={`${products.length} shown${status ? "" : " (archived hidden)"}`}
        actions={ctx.permissions.has("products.manage") && <Button asChild><Link href="/admin/products/new"><Plus /> New product</Link></Button>} />
      {first(sp.deleted) && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">Product deleted.</p>}
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Name or SKU" maxLength={60} className={`${fieldClass} max-w-xs`} aria-label="Search products" />
        <select name="status" defaultValue={status ?? ""} className={`${fieldClass} w-auto`} aria-label="Status">
          <option value="">Draft + active</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option>
        </select>
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      <Table scroll head={[<span key="img" className="sr-only">Photo</span>, "Product", "Category", "Price", "Stock", "Status"]} empty="No products found.">
        {products.map((p) => {
          const img = p.images.find((i) => i.is_primary) ?? p.images[0];
          const low = p.track_inventory && p.stock_quantity <= p.low_stock_threshold;
          return (
            <tr key={p.id} className="hover:bg-muted/40">
              <Td className="w-14">
                <div className="relative size-10 overflow-hidden rounded-md bg-muted">
                  {img && <Image src={publicImageUrl("product-images", img.storage_path)!} alt="" fill sizes="40px" className="object-cover" />}
                </div>
              </Td>
              <Td>
                <Link href={`/admin/products/${p.id}/edit`} className="font-medium text-primary hover:underline">{p.name_en}</Link>
                <span className="block text-xs text-muted-foreground">{p.sku}{p.is_featured && " · Featured"}</span>
              </Td>
              <Td>{p.category?.name_en}</Td>
              <Td className="tabular-nums">
                {p.sale_price_etb ? <><span className="text-destructive">{formatETB(toSantim(p.sale_price_etb))}</span> <s className="text-xs text-muted-foreground">{formatETB(toSantim(p.price_etb))}</s></> : formatETB(toSantim(p.price_etb))}
              </Td>
              <Td className={low ? "font-semibold text-destructive" : ""}>{p.track_inventory ? p.stock_quantity : "∞"}</Td>
              <Td><Badge variant={p.status === "active" ? "success" : p.status === "draft" ? "warning" : "secondary"}>{p.status}</Badge></Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
