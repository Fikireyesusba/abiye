import { z } from "zod";

/**
 * Shapes of public.website_settings values. Admin forms validate with these
 * before writing; storefront reads parse with them so a bad edit can never
 * crash the public site (falls back to defaults).
 */
const localized = z.object({ en: z.string().max(500), am: z.string().max(500) });
const longText = z.object({ en: z.string().max(30000), am: z.string().max(30000) });
const optionalUrl = z.url({ protocol: /^https$/ }).nullable();

/** Customer services that can be switched off (Admin → Manage services). */
export const SERVICE_KEYS = ["shop", "printing", "wallet", "reviews", "signup"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const settingsSchemas = {
  services: z.object({
    shop: z.boolean().default(true),
    printing: z.boolean().default(true),
    wallet: z.boolean().default(true),
    reviews: z.boolean().default(true),
    signup: z.boolean().default(true),
    note: localized.default({ en: "", am: "" }),
  }),
  business: z.object({
    name: localized,
    tagline: localized,
    logo_path: z.string().max(300).nullable(),
    // Square image for the installed app / browser tab (falls back to the logo).
    app_icon_path: z.string().max(300).nullable().default(null),
  }),
  contact: z.object({
    phone: z.string().max(30),
    email: z.email().nullable(),
    telegram: z.string().max(100).nullable(),
    whatsapp: z.string().max(30).nullable(),
    address: localized,
    map_url: optionalUrl,
  }),
  hours: localized,
  social: z.object({
    facebook: optionalUrl,
    instagram: optionalUrl,
    tiktok: optionalUrl,
    telegram: optionalUrl,
  }),
  delivery: z.object({
    pickup_enabled: z.boolean(),
    delivery_enabled: z.boolean(),
    free_delivery_threshold_etb: z.number().nonnegative().nullable(),
    payment_window_hours: z.int().min(1).max(168),
    payment_window_minutes: z.int().min(5).max(10080),
  }),
  printing: z.object({
    service_charge_etb: z.number().nonnegative().max(10000),
    max_file_mb: z.int().min(1).max(25),
    max_copies: z.int().min(1).max(1000),
    retention_days: z.int().min(1).max(365),
  }),
  legal: z.object({ terms: longText, privacy: longText, approved: z.boolean() }),
  homepage: z.object({
    hero_title: localized,
    hero_subtitle: localized,
    hero_image_path: z.string().max(300).nullable(),
    why_us: z.array(localized).max(6),
  }),
} as const;

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings<K extends SettingsKey> = z.infer<(typeof settingsSchemas)[K]>;
