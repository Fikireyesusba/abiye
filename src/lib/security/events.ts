import "server-only";
import { telegramSoon } from "@/lib/telegram/dispatch";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { clientIpKey } from "./rate-limit";

export type SecurityEventKind =
  | "admin_login_failed" | "admin_login_not_staff" | "admin_mfa_failed" | "admin_login_success"
  | "customer_login_failed" | "staff_customer_login" | "login_blocked" | "signup_blocked" | "rate_limited"
  | "upload_blocked" | "scan_unavailable";

/**
 * Records a security event (Admin → Security). Never throws and never blocks
 * the visitor: monitoring must not break sign-in. The network address is
 * stored only as a truncated hash; passwords are never recorded.
 */
export async function recordSecurityEvent(kind: SecurityEventKind, opts: { email?: string | null; userId?: string | null; metadata?: Record<string, unknown> } = {}) {
  try {
    const h = await headers();
    await getSupabaseAdmin().rpc("record_security_event", {
      p_kind: kind,
      p_email: opts.email ?? undefined,
      p_user_id: opts.userId ?? undefined,
      p_ip_hash: await clientIpKey(),
      p_user_agent: h.get("user-agent")?.slice(0, 300) ?? undefined,
      p_metadata: (opts.metadata ?? {}) as never,
    });
    telegramSoon(); // security event → staff Telegram
  } catch (e) {
    console.error("[security] event not recorded:", (e as Error).message);
  }
}

/** Is this email on the block list? (Fails open only if the check itself is unavailable, e.g. before the database update.) */
export async function isEmailBlocked(email: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("is_email_blocked", { p_email: email });
  if (error) return false;
  return data === true;
}

/** Scheduled job heartbeat for Admin → Security → Site health. */
export async function recordCronRun(name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  try {
    await getSupabaseAdmin().rpc("record_cron_run", { p_name: name, p_ok: ok, p_detail: detail as never });
  } catch {}
}
