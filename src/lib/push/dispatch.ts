import "server-only";
import webpush from "web-push";
import { getSiteSettings } from "@/lib/catalog/settings";
import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildPush } from "./templates";

/** Notifications not sent within a day are dropped instead of arriving late. */
const MAX_AGE_MS = 24 * 3600 * 1000;

export function pushConfigured(): boolean {
  const env = getServerEnv();
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** Test hook: send to a local mock instead of the real push service (localhost only, see env.ts). */
function endpointFor(endpoint: string): string {
  const base = getServerEnv().PUSH_TEST_ENDPOINT_BASE;
  if (!base) return endpoint;
  const u = new URL(endpoint);
  return `${base}${u.pathname}${u.search}`;
}

export interface PushSummary {
  configured: boolean;
  sent: number;
  failed: number;
}

/** Claim due phone notifications (SKIP LOCKED) and send them to each of the customer's devices. */
export async function dispatchCustomerPush(limit = 20): Promise<PushSummary> {
  if (!pushConfigured()) return { configured: false, sent: 0, failed: 0 };
  const env = getServerEnv();
  const db = getSupabaseAdmin();
  const { data: rows, error } = await db.rpc("claim_outbox", { p_channel: "push", p_limit: limit });
  if (error) {
    console.error("[push] claim failed:", error.message);
    return { configured: true, sent: 0, failed: 0 };
  }
  const summary: PushSummary = { configured: true, sent: 0, failed: 0 };
  if (!rows?.length) return summary;
  const business = (await getSiteSettings()).business.name;
  const giveUp = (id: number, reason: string) =>
    db.from("notifications_outbox").update({ status: "dead", last_error: reason.slice(0, 1000), locked_until: null }).eq("id", id).eq("status", "processing");

  for (const row of rows) {
    if (Date.now() - Date.parse(row.created_at) > MAX_AGE_MS) {
      await giveUp(row.id, "skipped: older than 1 day");
      continue;
    }
    const { data: devices } = row.recipient_user_id ? await db.rpc("push_targets", { p_user_id: row.recipient_user_id }) : { data: [] };
    let delivered = 0;
    let transient: string | null = null;
    for (const d of devices ?? []) {
      const locale = d.locale === "am" ? "am" : "en";
      const msg = buildPush(row.event_type, (row.payload ?? {}) as Record<string, unknown>, locale, business[locale] || business.en);
      if (!msg) continue;
      try {
        await webpush.sendNotification(
          { endpoint: endpointFor(d.endpoint), keys: { p256dh: d.p256dh, auth: d.auth } },
          JSON.stringify({ ...msg, icon: "/app-icon/192" }),
          {
            vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
            TTL: 24 * 3600,
            urgency: "normal",
            timeout: 10000,
          },
        );
        delivered++;
        await db.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", d.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the device unsubscribed or the app was removed — forget it.
        if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", d.id);
        else if (status === undefined || status === 429 || status >= 500) transient = `${status ?? "network"}: ${(e as Error).message}`;
        else console.error(`[push] permanent failure for device ${d.id}: ${status}`);
      }
    }
    if (transient && delivered === 0) {
      await db.rpc("complete_notification", { p_id: row.id, p_success: false, p_error: transient });
      summary.failed++;
    } else {
      await db.rpc("complete_notification", { p_id: row.id, p_success: true });
      if (delivered) summary.sent++;
    }
  }
  return summary;
}
