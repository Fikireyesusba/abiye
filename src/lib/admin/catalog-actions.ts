"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PRODUCT_IMAGE_TYPES, validateUpload } from "@/lib/validation/upload";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const guid = z.guid();
const money = z.coerce.number().positive().max(10_000_000).multipleOf(0.01);
const optMoney = z.union([z.literal(""), money]).transform((v) => (v === "" ? null : v));
const text = (max: number) => z.string().trim().max(max);

export async function slugify(input: string): Promise<string> {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const productSchema = z
  .object({
    id: z.union([z.literal(""), guid]),
    name_en: text(160).min(1, "English name is required"),
    name_am: text(160).min(1, "Amharic name is required"),
    slug: text(100),
    sku: z.string().trim().regex(/^[A-Za-z0-9._-]{2,40}$/, "SKU: 2–40 letters, digits, . _ -"),
    brand: text(80),
    category_id: guid,
    price_etb: money,
    sale_price_etb: optMoney,
    description_en: text(5000),
    description_am: text(5000),
    status: z.enum(["draft", "active", "archived"]),
    is_featured: z.literal("on").optional(),
    track_inventory: z.literal("on").optional(),
    low_stock_threshold: z.coerce.number().int().min(0).max(100000),
    stock_quantity: z.union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)]).optional(),
  })
  .refine((v) => v.sale_price_etb === null || v.sale_price_etb < v.price_etb, { message: "Sale price must be lower than the regular price" });

export async function saveProduct(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("products.manage");
  const parsed = productSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const v = parsed.data;
  const slug = v.slug ? await slugify(v.slug) : await slugify(v.name_en);
  if (!slug) return fail("Enter a URL slug (English letters/numbers).");
  const row = {
    name_en: v.name_en, name_am: v.name_am, slug, sku: v.sku, brand: v.brand || null, category_id: v.category_id,
    price_etb: v.price_etb, sale_price_etb: v.sale_price_etb, description_en: v.description_en, description_am: v.description_am,
    status: v.status, is_featured: v.is_featured === "on", track_inventory: v.track_inventory === "on",
    low_stock_threshold: v.low_stock_threshold, updated_by: ctx.userId,
  };
  const supabase = await createSupabaseServerClient();
  if (v.id) {
    const { error } = await supabase.from("products").update(row).eq("id", v.id);
    if (error) return dbError(error);
    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${v.id}/edit`);
    return ok("Product saved.");
  }
  const { data, error } = await supabase
    .from("products")
    .insert({ ...row, stock_quantity: typeof v.stock_quantity === "number" ? v.stock_quantity : 0, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) return dbError(error);
  revalidatePath("/admin/products");
  redirect(`/admin/products/${data.id}/edit?created=1`);
}

export async function setProductStatus(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("products.manage");
  const parsed = z.object({ id: guid, status: z.enum(["draft", "active", "archived"]) }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("products").update({ status: parsed.data.status }).eq("id", parsed.data.id);
  if (error) return dbError(error);
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${parsed.data.id}/edit`);
  return ok(parsed.data.status === "archived" ? "Product archived (hidden from the shop, history kept)." : `Product set to ${parsed.data.status}.`);
}

export async function deleteProduct(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("products.manage");
  const id = guid.safeParse(fd.get("id"));
  if (!id.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { data: images } = await supabase.from("product_images").select("storage_path").eq("product_id", id.data);
  const { error } = await supabase.from("products").delete().eq("id", id.data);
  if (error) {
    if (error.code === "23503") return fail("This product has orders or stock history, so it cannot be deleted. Archive it instead.");
    return dbError(error);
  }
  if (images?.length) await supabase.storage.from("product-images").remove(images.map((i) => i.storage_path));
  revalidatePath("/admin/products");
  redirect("/admin/products?deleted=1");
}

/** Called after the browser uploaded to product-images/products/<id>/<uuid>.<ext>. Verifies content before linking. */
export async function attachProductImage(input: { productId: unknown; path: unknown; altEn?: unknown; altAm?: unknown }): Promise<ActionResult> {
  await requirePermission("products.manage");
  const productId = guid.safeParse(input.productId);
  if (!productId.success || typeof input.path !== "string") return fail("Invalid request.");
  const m = input.path.match(new RegExp(`^products/${productId.data}/[0-9a-f-]{36}\\.(jpg|png|webp)$`));
  if (!m) return fail("Invalid upload path.");
  const supabase = await createSupabaseServerClient();
  const storage = supabase.storage.from("product-images");
  const { data: blob, error: dlError } = await storage.download(input.path);
  if (dlError || !blob) return fail("Upload not found.");
  const check = validateUpload(new Uint8Array(await blob.arrayBuffer()), { allowed: PRODUCT_IMAGE_TYPES, maxBytes: 5 * 1024 * 1024 });
  const expected = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[m[1] as "jpg" | "png" | "webp"];
  if (!check.ok || check.type !== expected) {
    await storage.remove([input.path]);
    return fail("That file is not a valid JPG, PNG or WebP image (max 5 MB).");
  }
  const { count } = await supabase.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId.data);
  const { error } = await supabase.from("product_images").insert({
    product_id: productId.data,
    storage_path: input.path,
    alt_en: typeof input.altEn === "string" ? input.altEn.slice(0, 200) || null : null,
    alt_am: typeof input.altAm === "string" ? input.altAm.slice(0, 200) || null : null,
    sort_order: count ?? 0,
    is_primary: (count ?? 0) === 0,
  });
  if (error) {
    await storage.remove([input.path]);
    return dbError(error);
  }
  revalidatePath(`/admin/products/${productId.data}/edit`);
  return ok("Image added.");
}

export async function setPrimaryImage(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("products.manage");
  const parsed = z.object({ imageId: guid, productId: guid }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error: e1 } = await supabase.from("product_images").update({ is_primary: false }).eq("product_id", parsed.data.productId);
  const { error: e2 } = e1 ? { error: e1 } : await supabase.from("product_images").update({ is_primary: true }).eq("id", parsed.data.imageId);
  if (e2) return dbError(e2);
  revalidatePath(`/admin/products/${parsed.data.productId}/edit`);
  return ok("Main image updated.");
}

export async function deleteProductImage(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("products.manage");
  const parsed = z.object({ imageId: guid, productId: guid }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { data: img, error } = await supabase.from("product_images").delete().eq("id", parsed.data.imageId).select("storage_path, is_primary").single();
  if (error) return dbError(error);
  await supabase.storage.from("product-images").remove([img.storage_path]);
  if (img.is_primary) {
    const { data: next } = await supabase.from("product_images").select("id").eq("product_id", parsed.data.productId).order("sort_order").limit(1);
    if (next?.[0]) await supabase.from("product_images").update({ is_primary: true }).eq("id", next[0].id);
  }
  revalidatePath(`/admin/products/${parsed.data.productId}/edit`);
  return ok("Image removed.");
}

// ---------------------------------------------------------------- categories
const categorySchema = z.object({
  id: z.union([z.literal(""), guid]),
  name_en: text(80).min(1, "English name is required"),
  name_am: text(80).min(1, "Amharic name is required"),
  slug: text(100),
  department: z.enum(["cosmetics", "electronics", "printing"]),
  parent_id: z.union([z.literal(""), guid]),
  sort_order: z.coerce.number().int().min(0).max(1000),
  is_active: z.literal("on").optional(),
});

export async function saveCategory(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("categories.manage");
  const parsed = categorySchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const v = parsed.data;
  const slug = await slugify(v.slug || v.name_en);
  if (!slug) return fail("Enter a URL slug (English letters/numbers).");
  const row = {
    name_en: v.name_en, name_am: v.name_am, slug, department: v.department, parent_id: v.parent_id || null,
    sort_order: v.sort_order, is_active: v.is_active === "on",
  };
  const supabase = await createSupabaseServerClient();
  const { error } = v.id ? await supabase.from("categories").update(row).eq("id", v.id) : await supabase.from("categories").insert(row);
  if (error) return dbError(error);
  revalidatePath("/admin/categories");
  return ok(v.id ? "Category saved." : "Category created.");
}

export async function deleteCategory(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("categories.manage");
  const id = guid.safeParse(fd.get("id"));
  if (!id.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("categories").delete().eq("id", id.data);
  if (error) {
    if (error.code === "23503") return fail("This category still has products or subcategories. Move them or deactivate the category instead.");
    return dbError(error);
  }
  revalidatePath("/admin/categories");
  return ok("Category deleted.");
}

// ---------------------------------------------------------------- inventory
export async function adjustStock(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("inventory.manage");
  const parsed = z
    .object({
      productId: guid,
      change: z.coerce.number().int().refine((n) => n !== 0 && Math.abs(n) <= 100000, "Enter a non-zero quantity"),
      reason: z.enum(["restock", "adjustment", "damage", "return"]),
      note: text(500).optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid adjustment.");
  const { productId, change, reason, note } = parsed.data;
  const signed = reason === "damage" ? -Math.abs(change) : reason === "restock" || reason === "return" ? Math.abs(change) : change;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_adjust_stock", { p_product_id: productId, p_change: signed, p_reason: reason, p_note: note || undefined });
  if (error) return dbError(error);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  return ok(`Stock updated: now ${data}.`);
}
