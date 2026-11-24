"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Couriers (Super Admin): fee per delivery, a courier's details / own fee, payouts. */
export async function saveCourierFee(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("couriers.manage");
  const v = z.object({ fee: z.coerce.number().min(0).max(100000) }).safeParse(formObject(fd));
  if (!v.success) return fail("Enter the amount in ETB (0 or more).");
  const { error } = await (await createSupabaseServerClient()).rpc("admin_set_courier_fee", { p_fee: Math.round(v.data.fee * 100) / 100 });
  if (error) return dbError(error);
  revalidatePath("/admin/couriers");
  return ok("Fee per delivery saved (applies to deliveries from now on).");
}

export async function saveCourier(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("couriers.manage");
  const v = z.object({
    courierId: z.guid(),
    phone: z.string().trim().regex(/^((\+251|0)?[79]\d{8})?$/, "Phone: an Ethiopian mobile number (e.g. 0911223344)."),
    vehicle: z.enum(["motorbike", "bicycle", "car", "on_foot", "other"]),
    plate: z.string().trim().max(20).regex(/^[A-Za-z0-9 -]*$/, "Plate number: letters, digits, spaces or -"),
    fee: z.union([z.literal(""), z.coerce.number().min(0).max(100000)]),
  }).safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Check the details.");
  const d = v.data;
  const { error } = await (await createSupabaseServerClient()).rpc("admin_update_courier", {
    p_courier: d.courierId, p_phone: d.phone ? `+251${d.phone.replace(/^(\+251|0)/, "")}` : "", p_vehicle: d.vehicle, p_plate: d.plate,
    p_fee_override: (d.fee === "" ? null : Math.round(d.fee * 100) / 100) as number,
  });
  if (error) return dbError(error);
  revalidatePath(`/admin/couriers/${d.courierId}`);
  return ok("Courier saved.");
}

export async function payCourier(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("couriers.manage");
  const v = z.object({ courierId: z.guid(), reference: z.string().trim().max(80).optional(), note: z.string().trim().max(300).optional() }).safeParse(formObject(fd));
  if (!v.success) return fail("Invalid request.");
  const { data, error } = await (await createSupabaseServerClient()).rpc("admin_pay_courier", {
    p_courier: v.data.courierId, p_reference: v.data.reference || undefined, p_note: v.data.note || undefined,
  });
  if (error) return error.message === "invalid_amount" ? fail("Nothing to pay — no unpaid deliveries.") : dbError(error);
  const r = data as { amount_etb: number; deliveries: number };
  revalidatePath(`/admin/couriers/${v.data.courierId}`);
  revalidatePath("/admin/couriers");
  return ok(`Payment of ${r.amount_etb} ETB for ${r.deliveries} deliveries recorded — the courier sees it in their app.`);
}
