"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const shopSchema = z.object({
  shopId: z.union([z.literal(""), z.guid()]).default(""),
  name: z.string().trim().min(2, "Shop name: at least 2 characters.").max(120),
  zone_id: z.guid({ message: "Choose the shop's city." }),
  address_line: z.string().trim().min(3, "Address: at least 3 characters.").max(300),
  landmark: z.string().trim().max(200).default(""),
  // Mobile (09…/07…) or landline (e.g. 046…); stored as +251…
  phone: z.string().trim().regex(/^(\+251|0)?[1-9]\d{8}$/, "Phone: an Ethiopian number (e.g. 0911223344 or 0462201122)."),
  opening_hours: z.string().trim().max(200).default(""),
  map_url: z.union([z.literal(""), z.string().trim().max(500).regex(/^https:\/\/[^\s<>"]+$/, "Map link: must start with https://")]).default(""),
  handling_fee_etb: z.coerce.number().min(0, "Handling fee: 0 or more.").max(100000),
  is_active: z.string().optional(),
});

/** Partner shop: create or change (Super Admin — partners.manage). */
export async function savePartnerShop(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("partners.manage");
  const v = shopSchema.safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Check the details.");
  const d = v.data;
  const { data, error } = await (await createSupabaseServerClient()).rpc("admin_save_partner_shop", {
    p_id: d.shopId || (null as unknown as string),
    p: {
      name: d.name, zone_id: d.zone_id, address_line: d.address_line, landmark: d.landmark, opening_hours: d.opening_hours, map_url: d.map_url,
      phone: `+251${d.phone.replace(/^(\+251|0)/, "")}`, handling_fee_etb: d.handling_fee_etb,
      is_active: d.shopId ? d.is_active === "on" : true,
    },
  });
  if (error) return error.message === "invalid_request" ? fail("Check the details (the shop name may already be used).") : dbError(error);
  revalidatePath("/admin/partners", "layout");
  if (!d.shopId) redirect(`/admin/partners/${data}?created=1`);
  return ok("Shop saved — customers see the new details at checkout.");
}

/** Link a "Partner shop" staff member to a shop (or unlink with an empty shop). */
export async function setPartnerStaff(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("partners.manage");
  const v = z.object({ profileId: z.guid(), shopId: z.union([z.literal(""), z.guid()]) }).safeParse(formObject(fd));
  if (!v.success) return fail("Choose a staff member.");
  const { error } = await (await createSupabaseServerClient()).rpc("admin_set_partner_staff", {
    p_profile: v.data.profileId, p_shop: v.data.shopId || (null as unknown as string),
  });
  if (error) return error.message === "invalid_assignee" ? fail("Only staff with the permission set “Partner shop” can be linked to a shop.") : dbError(error);
  revalidatePath("/admin/partners", "layout");
  return ok(v.data.shopId ? "Staff member linked — they can sign in to the Abiye Business app." : "Staff member removed from the shop.");
}

export async function payPartner(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("partners.manage");
  const v = z.object({ shopId: z.guid(), reference: z.string().trim().max(80).optional(), note: z.string().trim().max(300).optional() }).safeParse(formObject(fd));
  if (!v.success) return fail("Invalid request.");
  const { data, error } = await (await createSupabaseServerClient()).rpc("admin_pay_partner", {
    p_shop: v.data.shopId, p_reference: v.data.reference || undefined, p_note: v.data.note || undefined,
  });
  if (error) return error.message === "invalid_amount" ? fail("Nothing to pay — no unpaid orders.") : dbError(error);
  const r = data as { amount_etb: number; orders: number };
  revalidatePath("/admin/partners", "layout");
  return ok(`Payment of ${r.amount_etb} ETB for ${r.orders} orders recorded — the shop sees it in its app.`);
}
