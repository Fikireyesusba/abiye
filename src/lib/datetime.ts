/** Dates are always shown in Ethiopia's timezone, in the active language. */
export function formatDateTime(iso: string, locale: "en" | "am"): string {
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Addis_Ababa",
  }).format(new Date(iso));
}
