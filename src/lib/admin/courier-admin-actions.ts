"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const phone = (v: string) => (v ? `+251${v.replace(/^(\+251|0)/, "")}` : "");
const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);

/** Courier vehicle and documents (Super Admin). Motorcycle / car: make, model, plate, insurance and driving licence required. */
export async function saveCourier(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("couriers.manage");
  const v = z.object({
    courierId: z.guid(),
    phone: z.string().trim().regex(/^((\+251|0)?[79]\d{8})?$/, "Phone: an Ethiopian mobile number (e.g. 0911223344)."),
    vehicle: z.enum(["on_foot", "bicycle", "motorcycle", "car"], { message: "Choose how the courier delivers." }),
    vehicle_make: z.string().trim().max(40), vehicle_model: z.string().trim().max(40),
    plate_number: z.string().trim().max(20).regex(/^[A-Za-z0-9 -]*$/, "Plate number: letters, digits, spaces or -"),
    insurance_company: z.string().trim().max(80), insurance_policy: z.string().trim().max(40), insurance_expiry: day,
    licence_number: z.string().trim().max(30).regex(/^[A-Za-z0-9 /-]*$/, "Licence number: letters, digits, spaces, / or -"), licence_expiry: day,
  }).safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Check the details.");
  const d = v.data;
  const { error } = await (await createSupabaseServerClient()).rpc("admin_update_courier", {
    p_courier: d.courierId,
    p: { ...d, courierId: undefined, phone: phone(d.phone) },
  });
  if (error) {
    if (error.message === "invalid_request") return fail("Motorcycle or car: fill in make, model, plate number, insurance (company, policy number, expiry) and the driving licence (number, expiry).");
    return dbError(error);
  }
  revalidatePath(`/admin/couriers/${d.courierId}`);
  revalidatePath("/admin/couriers");
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

/** Recognise real audio by content (not the file name / browser type). */
function audioType(b: Uint8Array): { ext: string; mime: string } | null {
  const s = (o: number, t: string) => [...t].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (s(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: "mp3", mime: "audio/mpeg" };
  if (s(0, "OggS")) return { ext: "ogg", mime: "audio/ogg" };
  if (s(0, "RIFF") && s(8, "WAVE")) return { ext: "wav", mime: "audio/wav" };
  if (s(4, "ftyp")) return { ext: "m4a", mime: "audio/mp4" };
  return null;
}

/** Ringtone the courier app plays when a delivery is assigned (MP3 / OGG / WAV / M4A, max 2 MB). */
export async function uploadRingtone(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("couriers.manage");
  if (fd.get("remove") === "1") {
    const { error } = await (await createSupabaseServerClient()).rpc("admin_set_courier_ringtone", { p_path: null as unknown as string });
    if (error) return dbError(error);
    revalidatePath("/admin/couriers");
    return ok("Ringtone removed — the app uses its built-in ring.");
  }
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose an audio file.");
  if (file.size > 2 * 1024 * 1024) return fail("The file is too large (maximum 2 MB).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const t = audioType(bytes);
  if (!t) return fail("That is not an MP3, OGG, WAV or M4A audio file.");
  const path = `ringtones/${crypto.randomUUID()}.${t.ext}`;
  // Stored with the secret key only after the Super Admin check and the content check above.
  const { error: upErr } = await getSupabaseAdmin().storage.from("app-sounds").upload(path, new Blob([bytes], { type: t.mime }), { contentType: t.mime });
  if (upErr) return fail("Could not store the file. Please try again.");
  const { error } = await (await createSupabaseServerClient()).rpc("admin_set_courier_ringtone", { p_path: path });
  if (error) {
    await getSupabaseAdmin().storage.from("app-sounds").remove([path]);
    return dbError(error);
  }
  revalidatePath("/admin/couriers");
  return ok("Ringtone saved — couriers hear it when a delivery is assigned.");
}

/** Delivery monitor thresholds (Super Admin): when late deliveries and wrong PINs are alerted on Telegram. */
export async function saveDeliveryMonitor(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("couriers.manage");
  const v = z.object({
    enabled: z.string().optional(),
    dispatch_wait_hours: z.coerce.number().min(0.25, "Waiting for a courier: at least 0.25 h.").max(168),
    pickup_hours: z.coerce.number().min(0.25, "Not picked up: at least 0.25 h.").max(168),
    delivery_hours: z.coerce.number().min(0.25, "On the way: at least 0.25 h.").max(168),
    shop_collect_days: z.coerce.number().int().min(1, "At the shop: 1–60 days.").max(60),
    wrong_pin_alert: z.coerce.number().int().min(1, "Wrong PINs: 1–4.").max(4, "Wrong PINs: 1–4 (5 locks the order)."),
  }).safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Check the values.");
  const { error } = await (await createSupabaseServerClient()).rpc("admin_set_delivery_monitor", { p: { ...v.data, enabled: v.data.enabled === "on" } });
  if (error) return dbError(error);
  revalidatePath("/admin/delivery-monitor");
  return ok("Monitor settings saved.");
}
