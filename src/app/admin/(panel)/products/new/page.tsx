import type { Metadata } from "next";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  await requirePermission("products.manage");
  const supabase = await createSupabaseServerClient();
  const { data: categories } = await supabase.from("categories").select("id, name_en, department, parent_id").eq("is_active", true).order("sort_order");
  return (
    <>
      <PageHeader title="New product" description="Add images after creating the product." />
      <Panel><ProductForm categories={categories ?? []} /></Panel>
    </>
  );
}
