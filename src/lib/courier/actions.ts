"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { dbError, fail, formObject, ok, type ActionResult } from "@/lib/admin/result";
import { rateLimitAll } from "@/lib/security/rate-limit";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Courier app: only the courier's own deliveries (checked again in the database). */
const orderId = z.object({ orderId: z.guid() });

export async function pickUp(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("deliveries.own");
  const v = orderId.safeParse(formObject(fd));
  if (!v.success) return fail("Invalid request.");
  const { error } = await (await createSupabaseServerClient()).rpc("courier_pick_up", { p_order_id: v.data.orderId });
  if (error) return error.message === "invalid_transition" ? fail("This order cannot be picked up now (ask the office).") : dbError(error);
  dispatchSoon(); // customer: "on its way" (with the delivery code); office: Telegram
  revalidatePath("/courier");
  return ok("Picked up — the customer has been told it is on its way.");
}

export async function deliver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("deliveries.own");
  const v = z.object({ orderId: z.guid(), code: z.string().trim().regex(/^\d{4}$/, "Enter the customer's 4-digit code.") }).safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Invalid request.");
  if (!(await rateLimitAll([[`deliver:${ctx.userId}`, 30, 3600]]))) return fail("Too many tries. Please wait a while.");
  const { data, error } = await (await createSupabaseServerClient()).rpc("courier_deliver", { p_order_id: v.data.orderId, p_code: v.data.code });
  if (error) {
    if (error.message === "delivery_locked") return fail("Too many wrong codes — this delivery is locked. Call the office.");
    if (error.message === "invalid_transition") return fail("Mark the order as picked up first.");
    return dbError(error);
  }
  dispatchSoon();
  revalidatePath("/courier");
  return data === true ? ok("Delivered. Thank you!") : fail("That code is not right. Ask the customer to check their order page or email.");
}

export async function couldNotDeliver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("deliveries.own");
  const v = z.object({ orderId: z.guid(), reason: z.string().trim().min(3, "Say what happened (at least 3 characters).").max(300) }).safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Invalid request.");
  const { error } = await (await createSupabaseServerClient()).rpc("courier_fail", { p_order_id: v.data.orderId, p_reason: v.data.reason });
  if (error) return error.message === "invalid_transition" ? fail("Only an order on its way can be marked as not delivered.") : dbError(error);
  dispatchSoon();
  revalidatePath("/courier");
  return ok("Recorded — the office has been told and will arrange the next step.");
}
