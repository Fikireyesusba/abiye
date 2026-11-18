import "server-only";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sha256Hex } from "./tokens";

/**
 * Client IP for rate limiting. On Vercel, x-real-ip / x-forwarded-for are set
 * by the platform edge (client-supplied values are overwritten). Stored only
 * as a truncated hash.
 */
export async function clientIpKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return sha256Hex(`ip:${ip}`).slice(0, 32);
}

/**
 * Fixed-window limit shared across all serverless instances (public.check_rate_limit).
 * Fails CLOSED: if the limiter itself errors, the action is refused.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] check failed:", error.message);
    return false;
  }
  return data === true;
}

/** True only if every limit passes. */
export async function rateLimitAll(checks: Array<[key: string, limit: number, windowSeconds: number]>): Promise<boolean> {
  for (const [k, l, w] of checks) {
    if (!(await rateLimit(k, l, w))) return false;
  }
  return true;
}
