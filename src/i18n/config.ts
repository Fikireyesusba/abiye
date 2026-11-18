export const locales = ["en", "am"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Pick a field like name_en / name_am for the active locale, falling back to English. */
export function localized(row: object, field: string, locale: Locale): string {
  const r = row as Record<string, unknown>;
  const v = r[`${field}_${locale}`] || r[`${field}_en`];
  return typeof v === "string" ? v : "";
}
