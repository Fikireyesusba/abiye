"use server";
import { z } from "zod";
import { getCustomerUser } from "@/lib/account/session";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "@/lib/pricing/cart";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z
  .array(z.object({ productId: z.guid(), quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }))
  .max(MAX_CART_LINES);

/**
 * Saves a signed-in customer's basket (product ids + quantities only) so staff
 * can follow up on baskets left without checking out. Written through the
 * customer's own session: RLS limits it to their own row.
 */
export async function syncSavedCart(input: unknown): Promise<{ saved: boolean }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { saved: false };
  const user = await getCustomerUser();
  if (!user) return { saved: false };
  if (!(await rateLimit(`cart-sync:${user.id}`, 60, 600))) return { saved: false };
  const supabase = await createSupabaseServerClient();
  if (parsed.data.length === 0) {
    const { error } = await supabase.from("customer_carts").delete().eq("user_id", user.id);
    return { saved: !error };
  }
  const items = parsed.data.map((i) => ({ product_id: i.productId, quantity: i.quantity }));
  const { error } = await supabase.from("customer_carts").upsert({ user_id: user.id, items }, { onConflict: "user_id" });
  if (error) console.warn(`[cart-sync] ${error.code}`);
  return { saved: !error };
}
