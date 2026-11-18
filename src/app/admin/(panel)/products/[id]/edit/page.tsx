import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { ImageManager } from "@/components/admin/image-manager";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { deleteProduct, setProductStatus } from "@/lib/admin/catalog-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { isGuid } from "@/lib/orders/access";
import { publicImageUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params, searchParams }: PageProps<"/admin/products/[id]/edit">) {
  await requirePermission("products.manage");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase.from("products").select("*, images:product_images(id, storage_path, is_primary, sort_order)").eq("id", id).maybeSingle(),
    supabase.from("categories").select("id, name_en, department, parent_id").order("sort_order"),
  ]);
  if (!product) notFound();
  const images = [...product.images].sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({ id: i.id, is_primary: i.is_primary, url: publicImageUrl("product-images", i.storage_path)! }));

  return (
    <>
      <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Products</Link>
      <PageHeader title={product.name_en} description={`SKU ${product.sku} · stock ${product.track_inventory ? product.stock_quantity : "not tracked"} (change in Inventory)`}
        actions={product.status === "active" && <Link href={`/products/${product.slug}`} target="_blank" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">View in shop <ExternalLink className="size-3.5" /></Link>} />
      {first((await searchParams).created) && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">Product created. Add images below, then set it to Active.</p>}
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Details"><ProductForm values={product} categories={categories ?? []} /></Panel>
          <Panel title="Images"><ImageManager productId={product.id} images={images} /></Panel>
        </div>
        <Panel title="Visibility">
          <div className="space-y-3">
            {product.status !== "archived" ? (
              <ActionForm action={setProductStatus} hidden={{ id: product.id, status: "archived" }} submitLabel="Archive product" variant="outline"
                confirm="Archive this product? It disappears from the shop; order history is kept." className="[&_button]:w-full" />
            ) : (
              <ActionForm action={setProductStatus} hidden={{ id: product.id, status: "draft" }} submitLabel="Restore as draft" variant="outline" className="[&_button]:w-full" />
            )}
            <ActionForm action={deleteProduct} hidden={{ id: product.id }} submitLabel="Delete permanently" variant="outline"
              confirm="Delete permanently? Only possible if the product was never ordered." className="border-t pt-3 [&_button]:w-full" />
            <p className="text-xs text-muted-foreground">Products that were ordered can only be archived, so order history stays accurate.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
