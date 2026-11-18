/**
 * Ethiopian mobile numbers.
 *   Ethio Telecom: 09XXXXXXXX   Safaricom Ethiopia: 07XXXXXXXX
 * Accepted input forms: 0911223344, 911223344, 251911223344, +251911223344,
 * with optional spaces, dashes, dots or parentheses.
 * Canonical storage form (matches DB check constraint): +2519XXXXXXXX / +2517XXXXXXXX
 */
const CANONICAL = /^\+251[79]\d{8}$/;

export function normalizeEthiopianPhone(input: string): string | null {
  if (typeof input !== "string") return null;
  const compact = input.trim().replace(/[\s\-.()]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  let digits = compact.replace(/^\+/, "");
  if (digits.startsWith("00251")) digits = digits.slice(5);
  else if (digits.startsWith("251")) digits = digits.slice(3);
  else if (compact.startsWith("+")) return null; // some other country code
  else if (digits.startsWith("0")) digits = digits.slice(1);
  const canonical = `+251${digits}`;
  return CANONICAL.test(canonical) ? canonical : null;
}

export function isValidEthiopianPhone(input: string): boolean {
  return normalizeEthiopianPhone(input) !== null;
}

/** "+251911223344" -> "+251 91 122 3344" */
export function formatEthiopianPhone(canonical: string): string {
  if (!CANONICAL.test(canonical)) return canonical;
  const n = canonical.slice(4);
  return `+251 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}
