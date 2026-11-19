import "server-only";
import { getSiteSettings } from "@/lib/catalog/settings";
import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildCustomerEmail, type EmailContext } from "./templates";

/** Emails not sent within this time are dropped (e.g. email was not configured yet) instead of arriving days late. */
const MAX_AGE_MS = 2 * 24 * 3600 * 1000;

export function emailConfigured(): boolean {
  const env = getServerEnv();
  return !!env.RESEND_API_KEY && !!env.EMAIL_FROM;
}

type Result = { ok: true } | { ok: false; permanent: boolean; error: string };

async function send(to: string, built: { subject: string; html: string; text: string }, idempotencyKey: string): Promise<Result> {
  const env = getServerEnv();
  try {
    const res = await fetch(`${env.EMAIL_API_BASE ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        // Resend drops a repeated send with the same key (safe retries).
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: built.subject, html: built.html, text: built.text }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.text()).slice(0, 300);
    // 429 / 5xx: temporary. Other 4xx (bad address, unverified domain, bad key): retrying will not help.
    return { ok: false, permanent: res.status !== 429 && res.status < 500, error: `HTTP ${res.status}: ${body}` };
  } catch (e) {
    return { ok: false, permanent: false, error: (e as Error).message };
  }
}

export interface EmailSummary {
  configured: boolean;
  sent: number;
  failed: number;
}

/** Claim due customer emails (SKIP LOCKED), send them via Resend, record the outcome. */
export async function dispatchCustomerEmails(limit = 20): Promise<EmailSummary> {
  if (!emailConfigured()) return { configured: false, sent: 0, failed: 0 };
  const db = getSupabaseAdmin();
  const { data: rows, error } = await db.rpc("claim_outbox", { p_channel: "email", p_limit: limit });
  if (error) {
    // e.g. migration 0022 not applied yet
    console.error("[email] claim failed:", error.message);
    return { configured: true, sent: 0, failed: 0 };
  }
  const summary: EmailSummary = { configured: true, sent: 0, failed: 0 };
  if (!rows?.length) return summary;
  const s = await getSiteSettings();
  const ctx: EmailContext = { appUrl: getServerEnv().APP_URL, business: s.business.name, phone: s.contact.phone, address: s.contact.address };

  const giveUp = async (id: number, reason: string) =>
    db.from("notifications_outbox").update({ status: "dead", last_error: reason.slice(0, 1000), locked_until: null }).eq("id", id).eq("status", "processing");

  for (const row of rows) {
    if (Date.now() - Date.parse(row.created_at) > MAX_AGE_MS) {
      await giveUp(row.id, "skipped: older than 2 days");
      continue;
    }
    const built = buildCustomerEmail({ event_type: row.event_type, payload: (row.payload ?? {}) as Record<string, unknown> }, ctx);
    const { data: user } = row.recipient_user_id ? await db.auth.admin.getUserById(row.recipient_user_id) : { data: null };
    const to = user?.user?.email;
    if (!built || !to) {
      await giveUp(row.id, !built ? `unknown event ${row.event_type}` : "customer has no email address");
      summary.failed++;
      continue;
    }
    const res = await send(to, built, `outbox-${row.id}`);
    if (!res.ok && res.permanent) {
      console.error(`[email] permanent failure for outbox #${row.id}: ${res.error}`);
      await giveUp(row.id, res.error);
      summary.failed++;
      continue;
    }
    await db.rpc("complete_notification", { p_id: row.id, p_success: res.ok, p_error: res.ok ? undefined : res.error });
    if (res.ok) summary.sent++;
    else summary.failed++;
  }
  return summary;
}
