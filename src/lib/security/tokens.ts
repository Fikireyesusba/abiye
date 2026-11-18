import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Order / printing-job access secrets.
 *  - accessToken: 256-bit, base64url — embedded in the private order link.
 *  - trackingCode: 50-bit, Crockford base32 "XXXXX-XXXXX" — short enough to
 *    type on the /track-order page; paired with the order number and
 *    rate-limited, so brute force is infeasible.
 * Only SHA-256 hashes are stored in the database.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 symbols: byte & 31 is unbiased

export function generateAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateTrackingCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (const b of bytes) code += CROCKFORD[b & 31];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Uppercase, drop separators, map ambiguous characters (O→0, I/L→1). */
export function normalizeTrackingCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(s)) return null;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]*$/.test(a) || !/^[0-9a-f]*$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
