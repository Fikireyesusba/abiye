import "server-only";
import { cache } from "react";
import { getSupabasePublic } from "@/lib/supabase/public";
import { privacy, terms, toLegalText } from "@/content/legal";
import { settingsSchemas, type Settings, type SettingsKey } from "@/lib/validation/settings";

const DEFAULTS: { [K in SettingsKey]: Settings<K> } = {
  services: { shop: true, printing: true, wallet: true, reviews: true, signup: true, note: { en: "", am: "" } },
  business: { name: { en: "Abiye", am: "አብዬ" }, tagline: { en: "", am: "" }, logo_path: null, app_icon_path: null },
  contact: { phone: "", email: null, telegram: null, whatsapp: null, address: { en: "", am: "" }, map_url: null },
  hours: { en: "", am: "" },
  social: { facebook: null, instagram: null, tiktok: null, telegram: null },
  delivery: { pickup_enabled: true, delivery_enabled: true, free_delivery_threshold_etb: null, payment_window_hours: 1, payment_window_minutes: 30 },
  printing: { service_charge_etb: 0, max_file_mb: 25, max_copies: 500, retention_days: 30 },
  legal: {
    terms: { en: toLegalText(terms.en), am: toLegalText(terms.am) },
    privacy: { en: toLegalText(privacy.en), am: toLegalText(privacy.am) },
    approved: false,
  },
  homepage: { hero_title: { en: "", am: "" }, hero_subtitle: { en: "", am: "" }, hero_image_path: null, why_us: [] },
};

export type SiteSettings = typeof DEFAULTS;

/**
 * All public website settings, validated. A malformed value (e.g. a bad admin
 * edit) falls back to its default instead of breaking the storefront.
 * Deduplicated per request with React cache.
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  const { data, error } = await getSupabasePublic().from("website_settings").select("key, value");
  if (error) {
    console.error("[settings] load failed", error.message);
    return DEFAULTS;
  }
  const out = { ...DEFAULTS } as Record<SettingsKey, unknown>;
  for (const row of data ?? []) {
    const key = row.key as SettingsKey;
    if (!(key in settingsSchemas)) continue;
    const parsed = settingsSchemas[key].safeParse(row.value);
    if (parsed.success) out[key] = parsed.data;
    else console.warn(`[settings] invalid value for "${key}", using default`);
  }
  return out as SiteSettings;
});
