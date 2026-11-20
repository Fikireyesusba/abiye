/** Dates are always shown in Ethiopia's timezone, in the active language. */
export function formatDateTime(iso: string, locale: "en" | "am"): string {
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Addis_Ababa",
  }).format(new Date(iso));
}

/** Date only (no time), Addis Ababa, in the active language. */
export function formatDate(iso: string, locale: "en" | "am"): string {
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "medium", timeZone: "Africa/Addis_Ababa" }).format(new Date(iso));
}

/** ISO timestamp → value for <input type="datetime-local"> in Addis Ababa time (UTC+3, no DST). */
export function toAddisInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (Addis Ababa time) → ISO timestamp, or null when empty/invalid. */
export function fromAddisInput(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
