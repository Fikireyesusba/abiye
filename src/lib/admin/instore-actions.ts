"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ethiopianPhoneSchema } from "@/lib/validation/checkout";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const saleSchema = z.object({
  items: z.array(z.object({ productId: z.guid(), quantity: z.int().min(1).max(1000) })).min(1).max(50),
  paymentMethod: z.enum(["cash", "mobile_money", "bank_transfer"]),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  discount: z.number().min(0).max(1_000_000).optional(),
  note: z.string().trim().max(500).optional(),
  key: z.guid(),
});

export type InStoreResult = { ok: true; orderId: string; orderNumber: string; total: number } | { ok: false; error: string };

/** Record a sale made at the shop counter (paid on the spot). Prices and stock come from the database. */
export async function recordInStoreSale(input: unknown): Promise<InStoreResult> {
  await requirePermission("orders.manage");
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Add at least one product with a quantity, and choose how it was paid." };
  const v = parsed.data;
  const phone = v.customerPhone ? ethiopianPhoneSchema.safeParse(v.customerPhone) : null;
  if (phone && !phone.success) return { ok: false, error: "Enter an Ethiopian mobile number (e.g. 0911 234 567) or leave it empty." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_create_instore_sale", {
    p_items: v.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
    p_payment_method: v.paymentMethod,
    p_customer_name: v.customerName || undefined,
    p_customer_phone: phone?.success ? phone.data : undefined,
    p_discount_etb: v.discount ?? 0,
    p_note: v.note || undefined,
    p_idempotency_key: v.key,
  });
  if (error) {
    const r = dbError(error);
    return { ok: false, error: r.ok ? "Could not record the sale." : r.error.replace("for that adjustment", "for this sale") };
  }
  const d = data as { order_id: string; order_number: string; total_etb: number };
  revalidatePath("/admin/in-store");
  revalidatePath("/admin/inventory");
  return { ok: true, orderId: d.order_id, orderNumber: d.order_number, total: Number(d.total_etb) };
}

/** Void a counter sale (mistake or return): stock comes back. */
export async function voidInStoreSale(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("orders.manage");
  const parsed = z.object({ orderId: z.guid(), reason: z.string().trim().min(2).max(500) }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Enter the reason for voiding the sale.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_void_instore_sale", { p_order_id: parsed.data.orderId, p_reason: parsed.data.reason });
  if (error) return dbError(error);
  revalidatePath("/admin/in-store");
  return ok("Sale voided — stock is back.");
}
