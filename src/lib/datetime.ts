/**
 * The shop's clock: Warsaw time (Europe/Warsaw, with summer time) for every date and time
 * the system shows, counts by day, or exports. The shop itself is in Ethiopia (ETB, +251).
 */
export const APP_TIME_ZONE = "Europe/Warsaw";
export const APP_TIME_LABEL = "Warsaw time";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Offset of Warsaw time from UTC at that moment, in milliseconds (+1 h in winter, +2 h in summer). */
export function zoneOffsetMs(at: Date): number {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** A Date whose UTC fields show the Warsaw wall-clock time (Excel shows the stored clock time). */
export function wallClock(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + zoneOffsetMs(d));
}

/** "YYYY-MM-DD HH:mm" in Warsaw time. */
export function zoneStamp(iso: string | Date): string {
  return wallClock(iso)?.toISOString().slice(0, 16).replace("T", " ") ?? "";
}

/** Today's date in Warsaw (YYYY-MM-DD). */
export function zoneToday(now = new Date()): string {
  return wallClock(now)!.toISOString().slice(0, 10);
}

/** Warsaw wall-clock "YYYY-MM-DDTHH:mm[:ss]" → the real moment (ISO). */
function fromWall(value: string): string {
  const guess = Date.parse(`${value.length === 16 ? `${value}:00` : value}Z`);
  let t = guess - zoneOffsetMs(new Date(guess));
  t = guess - zoneOffsetMs(new Date(t)); // second pass: correct around summer-time changes
  return new Date(t).toISOString();
}

/** Midnight at the start of a Warsaw day, as an ISO timestamp (for date-range filters). */
export function zoneDayStartIso(day: string): string {
  return fromWall(`${day}T00:00:00`);
}

/** Dates are always shown in Warsaw time, in the active language. */
export function formatDateTime(iso: string, locale: "en" | "am"): string {
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIME_ZONE,
  }).format(new Date(iso));
}

/** Date only (no time), Warsaw time, in the active language. */
export function formatDate(iso: string, locale: "en" | "am"): string {
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "medium", timeZone: APP_TIME_ZONE }).format(new Date(iso));
}

/** ISO timestamp → value for <input type="datetime-local"> in Warsaw time. */
export function toZoneInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return wallClock(iso)?.toISOString().slice(0, 16) ?? "";
}

/** <input type="datetime-local"> value (Warsaw time) → ISO timestamp, or null when empty/invalid. */
export function fromZoneInput(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = fromWall(value);
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
