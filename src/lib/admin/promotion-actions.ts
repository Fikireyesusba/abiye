"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { fromZoneInput } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PRODUCT_IMAGE_TYPES, validateUpload } from "@/lib/validation/upload";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const text = (max: number) => z.string().trim().max(max);
const optionalGuid = z.union([z.literal(""), z.guid()]).transform((v) => v || null);
const checkbox = z.literal("on").optional().transform(Boolean);

const promotionSchema = z
  .object({
    id: z.union([z.literal(""), z.guid()]),
    title_en: text(120).min(2),
    title_am: text(120).min(2),
    description_en: text(500),
    description_am: text(500),
    code: z.string().trim().regex(/^([A-Za-z0-9_-]{3,30})?$/, "Code: 3–30 letters, digits, - or _").transform((v) => v.toUpperCase() || null),
    discount_type: z.enum(["percent", "fixed"]),
    discount_value: z.coerce.number().positive().max(1_000_000),
    min_order_etb: z.coerce.number().min(0).max(10_000_000).default(0),
    scope: z.enum(["all", "category", "product"]),
    category_id: optionalGuid,
    product_id: optionalGuid,
    starts_at: z.string().optional(),
    ends_at: z.string().optional(),
    max_redemptions: z.union([z.literal(""), z.coerce.number().int().min(1).max(1_000_000)]).transform((v) => (v === "" ? null : v)),
    is_active: checkbox,
    show_on_homepage: checkbox,
    audience: z.enum(["everyone", "selected"]),
  })
  .superRefine((v, ctx) => {
    if (v.discount_type === "percent" && v.discount_value > 90) ctx.addIssue({ code: "custom", path: ["discount_value"], message: "A percentage discount can be at most 90%." });
    if (v.scope === "category" && !v.category_id) ctx.addIssue({ code: "custom", path: ["category_id"], message: "Choose a category." });
    if (v.scope === "product" && !v.product_id) ctx.addIssue({ code: "custom", path: ["product_id"], message: "Choose a product." });
    if (v.audience === "selected" && !v.code) ctx.addIssue({ code: "custom", path: ["code"], message: "A personal promotion needs a promo code." });
  });

export async function savePromotion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("promotions.manage");
  const parsed = promotionSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues.find((i) => i.code === "custom" || i.message.includes(":"))?.message ?? "Please check the highlighted values.");
  const v = parsed.data;
  const starts = fromZoneInput(v.starts_at);
  const ends = fromZoneInput(v.ends_at);
  if (starts && ends && ends <= starts) return fail("The end must be after the start.");
  const row = {
    title_en: v.title_en, title_am: v.title_am, description_en: v.description_en, description_am: v.description_am,
    code: v.code, discount_type: v.discount_type, discount_value: v.discount_value, min_order_etb: v.min_order_etb,
    category_id: v.scope === "category" ? v.category_id : null,
    product_id: v.scope === "product" ? v.product_id : null,
    // Every code: one use per customer account.
    starts_at: starts, ends_at: ends, max_redemptions: v.max_redemptions, once_per_customer: true,
    is_active: v.is_active, restricted: v.audience === "selected",
    // Personal codes are never advertised publicly.
    show_on_homepage: v.audience === "selected" ? false : v.show_on_homepage,
  };
  const supabase = await createSupabaseServerClient();
  const { error } = v.id ? await supabase.from("promotions").update(row).eq("id", v.id) : await supabase.from("promotions").insert(row);
  if (error) return error.code === "23505" ? fail("That promo code is already used by another promotion.") : dbError(error);
  revalidatePath("/admin/promotions");
  revalidatePath("/", "layout");
  return ok(v.id ? "Promotion saved." : "Promotion created.");
}

/** Delete: Super Admin only; only a promotion that was never used and that no customer holds. */
export async function deletePromotion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("promotions.manage");
  if (ctx.role !== "super_admin") return fail("Only the Super Admin can delete a promotion. Revoke it instead.");
  const id = z.guid().safeParse(fd.get("id"));
  if (!id.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_delete_promotion", { p_promotion_id: id.data });
  if (error) return dbError(error);
  revalidatePath("/admin/promotions");
  revalidatePath("/", "layout");
  return ok("Promotion deleted.");
}

/** Revoke (cancel) a promotion with a reason: it stops working at once and stays in the records. */
export async function revokePromotion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("promotions.manage");
  const parsed = z.object({ id: z.guid(), reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(300) }).safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_revoke_promotion", { p_promotion_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return error.message === "invalid_transition" ? fail("This promotion is already revoked.") : dbError(error);
  revalidatePath("/admin/promotions");
  revalidatePath("/admin/customers", "layout");
  revalidatePath("/", "layout");
  return ok("Promotion revoked — the code no longer works.");
}

// ---------------------------------------------------------------- homepage banners
const BANNER_PATH = /^banners\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const bannerSchema = z.object({
  id: z.union([z.literal(""), z.guid()]),
  title_en: text(120).min(2),
  title_am: text(120).min(2),
  subtitle_en: text(240),
  subtitle_am: text(240),
  link_href: z.string().trim().regex(/^(\/[A-Za-z0-9/_?=&.-]*)?$/, "Link: an address on this website starting with /, e.g. /cosmetics").transform((v) => v || null),
  sort_order: z.coerce.number().int().min(0).max(1000).default(0),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  is_active: checkbox,
  image_path: z.string().regex(BANNER_PATH).or(z.literal("")),
});

/** The browser uploads the image to site-assets/banners/<uuid>.<ext> first; the content is verified here. */
export async function saveBanner(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("promotions.manage");
  const parsed = bannerSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues.find((i) => i.message.includes(":"))?.message ?? "Please check the values.");
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const bucket = supabase.storage.from("site-assets");
  const { data: current } = v.id
    ? await supabase.from("homepage_banners").select("image_path").eq("id", v.id).maybeSingle()
    : { data: null };
  if (v.id && !current) return fail("Banner not found.");
  const imagePath = v.image_path || current?.image_path || "";
  if (!imagePath) return fail("Choose an image for the banner.");

  if (v.image_path && v.image_path !== current?.image_path) {
    const { data: blob } = await bucket.download(v.image_path);
    const check = blob ? validateUpload(new Uint8Array(await blob.arrayBuffer()), { allowed: PRODUCT_IMAGE_TYPES, maxBytes: 5 * 1024 * 1024 }) : null;
    if (!check?.ok) {
      await bucket.remove([v.image_path]);
      return fail("That file is not a valid JPG, PNG or WebP image (max 5 MB).");
    }
  }
  const starts = fromZoneInput(v.starts_at);
  const ends = fromZoneInput(v.ends_at);
  if (starts && ends && ends <= starts) return fail("The end must be after the start.");
  const row = {
    title_en: v.title_en, title_am: v.title_am, subtitle_en: v.subtitle_en, subtitle_am: v.subtitle_am,
    link_href: v.link_href, sort_order: v.sort_order, starts_at: starts, ends_at: ends, is_active: v.is_active, image_path: imagePath,
  };
  const { error } = v.id ? await supabase.from("homepage_banners").update(row).eq("id", v.id) : await supabase.from("homepage_banners").insert(row);
  if (error) return dbError(error);
  if (current?.image_path && current.image_path !== imagePath && BANNER_PATH.test(current.image_path)) await bucket.remove([current.image_path]);
  revalidatePath("/admin/promotions");
  revalidatePath("/", "layout");
  return ok(v.id ? "Banner saved." : "Banner created.");
}

export async function deleteBanner(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("promotions.manage");
  const id = z.guid().safeParse(fd.get("id"));
  if (!id.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase.from("homepage_banners").delete().eq("id", id.data).select("image_path").maybeSingle();
  if (error) return dbError(error);
  if (row?.image_path && BANNER_PATH.test(row.image_path)) await supabase.storage.from("site-assets").remove([row.image_path]);
  revalidatePath("/admin/promotions");
  revalidatePath("/", "layout");
  return ok("Banner deleted.");
}

// ---------------------------------------------------------------- personal codes
/** Give a personal promotion to customers, by User ID or email (one per line, or separated by commas/spaces). */
export async function assignPromotion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("promotions.manage");
  const id = z.guid().safeParse(fd.get("promotionId"));
  const emails = [...new Set(String(fd.get("emails") ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!id.success) return fail("Choose a promotion.");
  if (!emails.length) return fail("Enter at least one User ID or email address.");
  if (emails.length > 200) return fail("At most 200 customers at a time.");
  const bad = emails.filter((e) => !/^[1-9][0-9]{5}$/.test(e) && !z.email().safeParse(e).success);
  if (bad.length) return fail(`Not a User ID or email address: ${bad.slice(0, 3).join(", ")}`);
  const supabase = await createSupabaseServerClient();
  const note = String(fd.get("note") ?? "").trim().slice(0, 300) || undefined;
  const notify = fd.get("notify") === "on";
  const { data, error } = await supabase.rpc("admin_assign_promotion", { p_promotion_id: id.data, p_emails: emails, p_notify: notify, p_note: note });
  if (error) {
    if (error.message === "invalid_request") return fail("Set this promotion's audience to “Selected customers” first.");
    if (error.message === "invalid_transition") return fail("This promotion is revoked — it cannot be given any more.");
    return dbError(error);
  }
  const r = data as { added: string[]; already: string[]; not_found: string[] };
  if (notify && r.added.length) dispatchSoon(); // email + phone notification now
  revalidatePath("/admin/promotions");
  revalidatePath("/admin/customers", "layout");
  const parts = [
    r.added.length ? `Given to ${r.added.length} customer(s)${notify ? " and sent by email (and phone notification if turned on)" : ""}.` : null,
    r.already.length ? `Already had it: ${r.already.join(", ")}.` : null,
    r.not_found.length ? `No customer account with: ${r.not_found.join(", ")} (they must sign up first).` : null,
  ].filter(Boolean);
  return r.added.length || r.already.length ? ok(parts.join("\n")) : fail(parts.join("\n") || "Nothing changed.");
}

/** Remove a code from a customer (with a reason). Not possible once it was used. */
export async function unassignPromotion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("promotions.manage");
  const parsed = z.object({ promotionId: z.guid(), userId: z.guid(), reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(300) }).safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues.find((i) => i.path[0] === "reason")?.message ?? "Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_unassign_promotion", { p_promotion_id: parsed.data.promotionId, p_user_id: parsed.data.userId, p_reason: parsed.data.reason });
  if (error) return error.message === "promo_in_use" ? fail("This customer already used the code (or has an order waiting for payment with it) — it stays.") : dbError(error);
  revalidatePath("/admin/promotions");
  revalidatePath("/admin/customers", "layout");
  return ok("Code removed from this customer.");
}

/** Create a unique code for ONE customer (e.g. MEKDES-7K2Q), give it and send it by email / phone notification. */
export async function createPersonalCode(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("promotions.manage");
  const parsed = z.object({
    userId: z.guid(),
    discountType: z.enum(["percent", "fixed"]),
    value: z.coerce.number().positive("Enter the discount").max(100000),
    minOrder: z.union([z.literal(""), z.coerce.number().min(0).max(1000000)]).optional(),
    days: z.coerce.number().int().min(1, "Valid for at least 1 day").max(365, "At most 365 days"),
    note: z.string().trim().max(300).optional(),
  }).safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the discount.");
  const d = parsed.data;
  if (d.discountType === "percent" && d.value > 90) return fail("A percentage discount can be at most 90%.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_create_personal_code", {
    p_user_id: d.userId, p_discount_type: d.discountType, p_value: Math.round(d.value * 100) / 100,
    p_min_order: typeof d.minOrder === "number" ? d.minOrder : 0, p_days: d.days, p_note: d.note || undefined, p_notify: fd.get("notify") === "on",
  });
  if (error) {
    if (error.message === "staff_account") return fail("This is a staff account — personal codes are for customers.");
    if (error.message === "login_required") return fail("This customer has not confirmed their email yet.");
    return dbError(error);
  }
  const r = data as { code: string };
  if (fd.get("notify") === "on") dispatchSoon(); // email + phone notification now
  revalidatePath("/admin/promotions");
  revalidatePath("/admin/customers", "layout");
  return ok(`Code ${r.code} created and given${fd.get("notify") === "on" ? " — sent to the customer by email (and phone notification if turned on)" : ""}.`);
}
