"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeEthiopianPhone } from "@/lib/validation/phone";
import { settingsSchemas, type SettingsKey } from "@/lib/validation/settings";
import { PRODUCT_IMAGE_TYPES, validateUpload } from "@/lib/validation/upload";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const s = (v: string | undefined) => (v ?? "").trim();
const nullable = (v: string | undefined) => s(v) || null;
const num = (v: string | undefined) => (s(v) === "" ? null : Number(v));
const pair = (f: Record<string, string>, k: string) => ({ en: s(f[`${k}_en`]), am: s(f[`${k}_am`]) });

/** FormData → settings value, per key. Unknown fields are ignored. */
function build(key: SettingsKey, f: Record<string, string>, current: Record<string, unknown>): unknown {
  switch (key) {
    case "business":
      return { name: pair(f, "name"), tagline: pair(f, "tagline"), logo_path: current.logo_path ?? null, app_icon_path: current.app_icon_path ?? null };
    case "contact": {
      const phone = normalizeEthiopianPhone(s(f.phone)) ?? s(f.phone);
      return { phone, email: nullable(f.email), telegram: nullable(f.telegram), whatsapp: nullable(f.whatsapp), address: pair(f, "address"), map_url: nullable(f.map_url) };
    }
    case "hours":
      return pair(f, "hours");
    case "services":
      return { shop: f.shop === "on", printing: f.printing === "on", wallet: f.wallet === "on", reviews: f.reviews === "on", signup: f.signup === "on", note: pair(f, "note") };
    case "social":
      return { facebook: nullable(f.facebook), instagram: nullable(f.instagram), tiktok: nullable(f.tiktok), telegram: nullable(f.telegram) };
    case "delivery":
      return {
        pickup_enabled: f.pickup_enabled === "on", delivery_enabled: f.delivery_enabled === "on",
        free_delivery_threshold_etb: num(f.free_delivery_threshold_etb), payment_window_minutes: Number(f.payment_window_minutes), payment_window_hours: Math.max(1, Math.ceil(Number(f.payment_window_minutes) / 60)),
      };
    case "printing":
      return { service_charge_etb: Number(f.service_charge_etb), max_file_mb: Number(f.max_file_mb), max_copies: Number(f.max_copies), retention_days: Number(f.retention_days) };
    case "legal": {
      const long = (k: string) => ({ en: (f[`${k}_en`] ?? "").trim(), am: (f[`${k}_am`] ?? "").trim() });
      return { terms: long("terms"), privacy: long("privacy"), approved: f.approved === "on" };
    }
    case "about":
      return {
        title: pair(f, "title"),
        body: { en: (f.body_en ?? "").trim(), am: (f.body_am ?? "").trim() },
        show_services: f.show_services === "on", show_why_us: f.show_why_us === "on",
      };
    case "homepage":
      return {
        hero_title: pair(f, "hero_title"), hero_subtitle: pair(f, "hero_subtitle"), hero_image_path: current.hero_image_path ?? null,
        why_us: [0, 1, 2].map((i) => pair(f, `why_${i}`)).filter((w) => w.en || w.am),
      };
  }
}

export async function saveSettings(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const key = String(fd.get("key")) as SettingsKey;
  if (!(key in settingsSchemas)) return fail("Unknown setting.");
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase.from("website_settings").select("value").eq("key", key).maybeSingle();
  const value = build(key, formObject(fd), (row?.value as Record<string, unknown>) ?? {});
  const parsed = settingsSchemas[key].safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`Check “${issue.path.join(" ")}”: ${issue.message}`);
  }
  const d = parsed.data as { pickup_enabled?: boolean; delivery_enabled?: boolean };
  if (key === "delivery" && !d.pickup_enabled && !d.delivery_enabled) {
    return fail("Keep at least one of delivery or pickup enabled, otherwise nobody can check out.");
  }
  const { error } = await supabase.from("website_settings").update({ value: parsed.data as NonNullable<Json> }).eq("key", key);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return ok("Settings saved — live on the website now.");
}

const SLOTS = {
  logo: { key: "business", field: "logo_path", done: "Logo updated." },
  appIcon: { key: "business", field: "app_icon_path", done: "App icon updated." },
  hero: { key: "homepage", field: "hero_image_path", done: "Homepage image updated." },
} as const;
const slotSchema = z.enum(["logo", "appIcon", "hero"]);

/** Logo / app icon / hero image: browser uploads to site-assets/branding/<uuid>.<ext>; we verify content, then link it. */
export async function setBrandImage(input: { slot: unknown; path: unknown }): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const slot = slotSchema.safeParse(input.slot);
  const path = typeof input.path === "string" ? input.path : "";
  const m = path.match(/^branding\/[0-9a-f-]{36}\.(jpg|png|webp)$/);
  if (!slot.success || !m) return fail("Invalid upload.");
  const supabase = await createSupabaseServerClient();
  const bucket = supabase.storage.from("site-assets");
  const { data: blob } = await bucket.download(path);
  // The app icon is drawn by the server image renderer, which reads PNG and JPG (not WebP).
  const allowed = slot.data === "appIcon" ? PRODUCT_IMAGE_TYPES.filter((t) => t !== "image/webp") : PRODUCT_IMAGE_TYPES;
  const check = blob ? validateUpload(new Uint8Array(await blob.arrayBuffer()), { allowed, maxBytes: 5 * 1024 * 1024 }) : null;
  if (!check?.ok) {
    await bucket.remove([path]);
    return fail(slot.data === "appIcon" ? "Use a PNG or JPG image (max 5 MB) for the app icon." : "That file is not a valid JPG, PNG or WebP image (max 5 MB).");
  }
  const { key, field, done } = SLOTS[slot.data];
  const { data: row } = await supabase.from("website_settings").select("value").eq("key", key).single();
  const value = { ...(row?.value as Record<string, Json>), [field]: path };
  const { error } = await supabase.from("website_settings").update({ value }).eq("key", key);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  revalidatePath("/manifest.webmanifest");
  return ok(done);
}

export async function clearBrandImage(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const slot = slotSchema.safeParse(fd.get("slot"));
  if (!slot.success) return fail("Invalid request.");
  const { key, field } = SLOTS[slot.data];
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase.from("website_settings").select("value").eq("key", key).single();
  const { error } = await supabase.from("website_settings").update({ value: { ...(row?.value as Record<string, Json>), [field]: null } }).eq("key", key);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  revalidatePath("/manifest.webmanifest");
  return ok("Image removed.");
}

// ---------------------------------------------------------------- bank accounts (Super Admin)
const bankSchema = z.object({
  id: z.union([z.literal(""), z.guid()]),
  bank_name: z.string().trim().min(2).max(80),
  account_holder: z.string().trim().min(2).max(120),
  account_number: z.string().trim().regex(/^[0-9 -]{6,30}$/, "Account number: 6–30 digits"),
  branch: z.string().trim().max(80),
  instructions_en: z.string().trim().max(1000),
  instructions_am: z.string().trim().max(1000),
  sort_order: z.coerce.number().int().min(0).max(100),
  is_active: z.literal("on").optional(),
});

export async function saveBankAccount(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("bank_accounts.manage");
  const parsed = bankSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the bank details.");
  const { id, is_active, branch, ...rest } = parsed.data;
  const row = { ...rest, branch: branch || null, is_active: is_active === "on" };
  const supabase = await createSupabaseServerClient();
  const { error } = id ? await supabase.from("bank_accounts").update(row).eq("id", id) : await supabase.from("bank_accounts").insert(row);
  if (error) return dbError(error);
  if (!row.is_active) {
    const { count } = await supabase.from("bank_accounts").select("id", { count: "exact", head: true }).eq("is_active", true);
    if (!count) return ok("Saved — WARNING: no active bank account, customers cannot check out until one is active.");
  }
  revalidatePath("/admin/settings");
  return ok("Bank account saved. New orders use it; existing orders keep the details they were placed with.");
}

// ---------------------------------------------------------------- delivery zones
const zoneSchema = z.object({
  id: z.union([z.literal(""), z.guid()]),
  name_en: z.string().trim().min(2).max(80),
  name_am: z.string().trim().min(1).max(80),
  fee_etb: z.coerce.number().min(0).max(100000),
  estimated_days: z.string().trim().max(40),
  sort_order: z.coerce.number().int().min(0).max(1000),
  is_active: z.literal("on").optional(),
});

export async function saveDeliveryZone(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const parsed = zoneSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the delivery zone.");
  const { id, is_active, estimated_days, ...rest } = parsed.data;
  const row = { ...rest, estimated_days: estimated_days || null, is_active: is_active === "on" };
  const supabase = await createSupabaseServerClient();
  const { error } = id ? await supabase.from("delivery_zones").update(row).eq("id", id) : await supabase.from("delivery_zones").insert(row);
  if (error) return dbError(error);
  revalidatePath("/admin/settings");
  return ok("Delivery zone saved.");
}
