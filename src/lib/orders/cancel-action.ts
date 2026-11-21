"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCustomerUser } from "@/lib/account/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchSoon } from "@/lib/telegram/dispatch";

export type CancelResult = { ok: true } | { ok: false; error: "login_required" | "not_allowed" | "rate_limited" | "failed" };

/**
 * The customer cancels their own order — possible until staff approve the payment.
 * The database checks the owner and the status, releases the stock and records it.
 */
export async function cancelMyOrder(orderId: unknown, reason: unknown): Promise<CancelResult> {
  const user = await getCustomerUser();
  if (!user) return { ok: false, error: "login_required" };
  const id = z.guid().safeParse(orderId);
  if (!id.success) return { ok: false, error: "failed" };
  if (!(await rateLimit(`order:cancel:${user.id}`, 10, 3600))) return { ok: false, error: "rate_limited" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("customer_cancel_order", {
    p_order_id: id.data,
    p_reason: typeof reason === "string" ? reason.trim().slice(0, 500) || undefined : undefined,
  });
  if (error) {
    if (error.message === "invalid_transition" || error.message === "not_found") return { ok: false, error: "not_allowed" };
    console.warn(`[order] customer cancel failed: ${error.code}`);
    return { ok: false, error: "failed" };
  }
  dispatchSoon(); // customer email: order cancelled
  revalidatePath(`/order-success/${id.data}`);
  revalidatePath("/account");
  return { ok: true };
}
