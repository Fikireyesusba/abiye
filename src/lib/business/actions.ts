"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { dbError, fail, formObject, ok, type ActionResult } from "@/lib/admin/result";
import { rateLimitAll } from "@/lib/security/rate-limit";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Abiye Business app: only the orders of the signed-in staff member's shop (checked again in the database). */
const pinForm = (what: string) => z.object({ orderId: z.guid(), code: z.string().trim().regex(/^\d{4}$/, `Enter the ${what}'s 4-digit PIN.`) });

/** The courier arrived: the shop enters the courier's PIN. */
export async function receiveFromCourier(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("partner.own");
  const v = pinForm("courier").safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Invalid request.");
  if (!(await rateLimitAll([[`partner-pin:${ctx.userId}`, 40, 3600]]))) return fail("Too many tries. Please wait a while.");
  const { data, error } = await (await createSupabaseServerClient()).rpc("partner_receive", { p_order_id: v.data.orderId, p_courier_code: v.data.code });
  if (error) {
    if (error.message === "handoff_locked") return fail("Too many wrong PINs — this hand-over is locked. Call the Abiye office.");
    if (error.message === "invalid_transition") return fail("This order is not on its way to you now.");
    return dbError(error);
  }
  dispatchSoon();
  revalidatePath("/business", "layout");
  return data === true ? ok("Courier's PIN checked. The courier now enters your shop PIN.") : fail("That PIN is not right. Ask the courier to check their app.");
}

/** The customer came: the shop enters the customer's PIN → order completed. */
export async function handToCustomer(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("partner.own");
  const v = pinForm("customer").safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Invalid request.");
  if (!(await rateLimitAll([[`partner-pin:${ctx.userId}`, 40, 3600]]))) return fail("Too many tries. Please wait a while.");
  const { data, error } = await (await createSupabaseServerClient()).rpc("partner_hand_over", { p_order_id: v.data.orderId, p_pin: v.data.code });
  if (error) {
    if (error.message === "delivery_locked") return fail("Too many wrong PINs — this order is locked. Call the Abiye office.");
    if (error.message === "invalid_transition") return fail("This order is not waiting at your shop.");
    return dbError(error);
  }
  dispatchSoon();
  revalidatePath("/business", "layout");
  return data === true ? ok("Handed over to the customer. Thank you!") : fail("That PIN is not right. Ask the customer to check their order page or email.");
}
