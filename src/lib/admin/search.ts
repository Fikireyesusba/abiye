import { sanitizeSearchTerm } from "@/lib/catalog/search";
import { normalizeEthiopianPhone } from "@/lib/validation/phone";

/** Interpret an admin order search: order number, phone, or customer name. */
export function parseOrderSearch(raw: unknown):
  | { kind: "number"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "name"; value: string }
  | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim().slice(0, 40);
  const num = s.toUpperCase().replace(/\s+/g, "").match(/^(?:ET-?)?(\d{5,9})$/);
  if (num) return { kind: "number", value: `ET-${num[1]}` };
  const phone = normalizeEthiopianPhone(s);
  if (phone) return { kind: "phone", value: phone };
  const name = sanitizeSearchTerm(s);
  return name.length >= 2 ? { kind: "name", value: name } : null;
}
