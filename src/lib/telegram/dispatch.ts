import "server-only";
import { loadOrderBreakdown } from "@/lib/orders/breakdown";
import { surfaceUrl } from "@/lib/security/hosts";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env";
import { dispatchCustomerEmails } from "@/lib/email/dispatch";
import { dispatchReceiptArchive } from "@/lib/email/archive";
import { dispatchCustomerPush } from "@/lib/push/dispatch";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { deleteDuePrintingFilesQuietly } from "@/lib/printing/retention";
import { sendMedia, sendMessage, type SendResult, type TelegramConfig } from "./client";
import { buildMessage, CAPTION_LIMIT, esc, MESSAGE_LIMIT, truncate, type OutboxRow } from "./format";

const ATTACHMENT_BUCKETS = new Set(["payment-receipts", "printing-files"]);
const FEED_EVENTS = new Set(["security_event", "security_alert", "admin_action", "notification_copy", "security_test", "stock_test", "receipts_test"]);

/** Orders & payments group (first bot). */
export function telegramConfig(): TelegramConfig | null {
  const env = getServerEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID) return null;
  return { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ADMIN_CHAT_ID, apiBase: env.TELEGRAM_API_BASE ?? "https://api.telegram.org" };
}

export type TelegramGroup = "orders" | "security" | "stock" | "receipts" | "printing" | "support";
export const TELEGRAM_GROUPS = ["orders", "security", "stock", "receipts", "printing", "support"] as const;

function configFrom(token: string | undefined, chatId: string | undefined): TelegramConfig | null {
  if (!token || !chatId) return null;
  return { token, chatId, apiBase: getServerEnv().TELEGRAM_API_BASE ?? "https://api.telegram.org" };
}

/** Bot + chat of a group (null = not set up). */
export function groupConfig(group: TelegramGroup): TelegramConfig | null {
  const env = getServerEnv();
  switch (group) {
    case "orders": return configFrom(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_ADMIN_CHAT_ID);
    case "security": return configFrom(env.TELEGRAM_SECURITY_BOT_TOKEN, env.TELEGRAM_SECURITY_CHAT_ID);
    case "stock": return configFrom(env.TELEGRAM_STOCK_BOT_TOKEN, env.TELEGRAM_STOCK_CHAT_ID);
    case "receipts": return configFrom(env.TELEGRAM_RECEIPTS_BOT_TOKEN, env.TELEGRAM_RECEIPTS_CHAT_ID);
    case "printing": return configFrom(env.TELEGRAM_PRINTING_BOT_TOKEN, env.TELEGRAM_PRINTING_CHAT_ID);
    case "support": return configFrom(env.TELEGRAM_SUPPORT_BOT_TOKEN, env.TELEGRAM_SUPPORT_CHAT_ID);
  }
}

/** Security group (second bot): security events, alerts, admin sign-ins and admin actions. */
export function securityTelegramConfig(): TelegramConfig | null {
  const env = getServerEnv();
  if (!env.TELEGRAM_SECURITY_BOT_TOKEN || !env.TELEGRAM_SECURITY_CHAT_ID) return null;
  return { token: env.TELEGRAM_SECURITY_BOT_TOKEN, chatId: env.TELEGRAM_SECURITY_CHAT_ID, apiBase: env.TELEGRAM_API_BASE ?? "https://api.telegram.org" };
}

/** "Open in admin" links: Super Admin address for the security and receipts groups, staff address otherwise. */
function adminBase(group: TelegramGroup): string {
  return surfaceUrl(group === "security" || group === "receipts" ? "super" : "staff") ?? getServerEnv().APP_URL;
}

/** Payment alerts: what was bought, read fresh from the order (every line, delivery fee and discounts). */
const BREAKDOWN_EVENTS = new Set(["new_order", "payment_resubmitted", "payment_verified"]);

async function deliver(cfg: TelegramConfig, row: OutboxRow, group: TelegramGroup = "orders"): Promise<SendResult> {
  if (BREAKDOWN_EVENTS.has(row.event_type) && typeof row.payload.order_id === "string") {
    const breakdown = await loadOrderBreakdown(getSupabaseAdmin(), row.payload.order_id).catch(() => null);
    if (breakdown) row = { ...row, payload: { ...row.payload, breakdown } };
  }
  const msg = buildMessage(row, adminBase(group));
  // Excel exports: the file itself, then it is removed from storage (Telegram keeps the copy).
  if (row.event_type === "excel_export" && msg.attachment?.bucket === "excel-exports") {
    const store = getSupabaseAdmin().storage.from("excel-exports");
    const { data: blob } = await store.download(msg.attachment.path);
    if (!blob) return { ok: false, kind: "permanent", error: "Excel file no longer in storage" };
    const name = String(row.payload.file_name ?? "export.xlsx").replace(/[\\/\r\n]/g, "_").slice(0, 120);
    const res = await sendMedia(cfg, "document", blob, name, truncate(msg.text, CAPTION_LIMIT));
    if (res.ok) await store.remove([msg.attachment.path]);
    return res;
  }
  // Printing documents: always as a file, with the customer's file name.
  if (row.event_type === "printing_document" && msg.attachment) {
    const { data: blob } = await getSupabaseAdmin().storage.from(msg.attachment.bucket).download(msg.attachment.path);
    if (!blob) return { ok: false, kind: "permanent", error: "document no longer in storage" };
    const name = String(row.payload.file_name ?? msg.attachment.path.split("/").pop() ?? "document").replace(/[\\/\r\n]/g, "_").slice(0, 120);
    return sendMedia(cfg, "document", blob, name, truncate(msg.text, CAPTION_LIMIT));
  }
  if (msg.attachment && ATTACHMENT_BUCKETS.has(msg.attachment.bucket) && msg.text.length > CAPTION_LIMIT) {
    // Too long for a photo caption (many products): the receipt with a short caption, then the full message.
    const { data: blob } = await getSupabaseAdmin().storage.from(msg.attachment.bucket).download(msg.attachment.path);
    if (blob) {
      const ext = msg.attachment.path.split(".").pop() ?? "bin";
      const name = `receipt-${row.payload.order_number ?? row.payload.number ?? row.id}.${ext}`;
      const caption = `🧾 Receipt for order ${esc(row.payload.order_number ?? "")} — details in the next message`;
      const first = await sendMedia(cfg, "document", blob, name, caption);
      if (!first.ok) return first;
    }
    return sendMessage(cfg, truncate(msg.text, MESSAGE_LIMIT));
  }
  if (msg.attachment && ATTACHMENT_BUCKETS.has(msg.attachment.bucket) && msg.text.length <= CAPTION_LIMIT) {
    const { data: blob } = await getSupabaseAdmin().storage.from(msg.attachment.bucket).download(msg.attachment.path);
    if (blob) {
      const ext = msg.attachment.path.split(".").pop() ?? "bin";
      const isImage = ext === "jpg" || ext === "png";
      // Photos are previewed inline in the chat; Telegram rejects photos > 10 MB, so send those as documents.
      const kind = isImage && blob.size <= 10 * 1024 * 1024 ? "photo" : "document";
      const res = await sendMedia(cfg, kind, blob, `receipt-${row.payload.order_number ?? row.payload.number ?? row.id}.${ext}`, msg.text);
      // A photo Telegram cannot process (e.g. odd dimensions) is retried once as a document.
      if (!res.ok && res.kind === "permanent" && kind === "photo") {
        return sendMedia(cfg, "document", blob, `receipt-${row.payload.order_number ?? row.payload.number ?? row.id}.${ext}`, msg.text);
      }
      return res;
    }
    // Receipt missing from storage: still notify (the admin link shows the order).
  }
  return sendMessage(cfg, truncate(msg.text, MESSAGE_LIMIT));
}

export interface DispatchSummary {
  configured: boolean;
  sent: number;
  failed: number;
}

/**
 * Claim due outbox rows (SKIP LOCKED — safe to run concurrently), send them,
 * record the outcome. Failures back off exponentially in the database and turn
 * "dead" after max attempts; nothing about the order itself is affected.
 */
export async function dispatchNotifications(limit = 20): Promise<DispatchSummary> {
  const results = await Promise.all(TELEGRAM_GROUPS.map((g) => dispatchGroup(g, limit)));
  return results.reduce((a, r) => ({ configured: a.configured || r.configured, sent: a.sent + r.sent, failed: a.failed + r.failed }), { configured: false, sent: 0, failed: 0 });
}

/**
 * One group: claim its due rows (SKIP LOCKED), send, record the outcome. A group that is not set up
 * leaves its rows waiting (they expire) — except stock alerts, which use the orders bot until a stock bot exists.
 */
export async function dispatchGroup(group: TelegramGroup | boolean, limit = 20): Promise<DispatchSummary> {
  const g: TelegramGroup = group === true ? "security" : group === false ? "orders" : group;
  if (g === "stock" && !groupConfig("stock")) return { configured: false, sent: 0, failed: 0 }; // sent by the orders bot below
  const cfg = groupConfig(g);
  const groups = g === "orders" && !groupConfig("stock") ? ["orders", "stock"] : [g];
  if (!cfg) return { configured: false, sent: 0, failed: 0 };
  const db = getSupabaseAdmin();
  const { data: rows, error } = await db.rpc("claim_telegram_groups", { p_groups: groups, p_limit: limit });
  if (error) {
    console.error("[telegram] claim failed:", error.message);
    return { configured: true, sent: 0, failed: 0 };
  }
  const summary: DispatchSummary = { configured: true, sent: 0, failed: 0 };
  let rateLimited: string | null = null;
  for (const row of (rows ?? []) as OutboxRow[]) {
    // Activity-feed messages older than a day (e.g. queued before Telegram was set up) are dropped, not sent late.
    if (FEED_EVENTS.has(row.event_type) && Date.now() - Date.parse((row as OutboxRow & { created_at: string }).created_at) > 24 * 3600 * 1000) {
      await db.from("notifications_outbox").update({ status: "dead", last_error: "skipped: older than 24 h", locked_until: null }).eq("id", row.id).eq("status", "processing");
      continue;
    }
    const res: SendResult = rateLimited ? { ok: false, kind: "retry", error: rateLimited } : await deliver(cfg, row, g);
    if (!res.ok && res.kind === "rate_limited") rateLimited = `rate limited by Telegram (retry after ${res.retryAfter}s)`;
    if (!res.ok && res.kind === "permanent") console.error(`[telegram] permanent failure for outbox #${row.id}: ${res.error}`);
    await db.rpc("complete_notification", { p_id: row.id, p_success: res.ok, p_error: res.ok ? undefined : res.error });
    if (res.ok) summary.sent++;
    else summary.failed++;
  }
  return summary;
}

/** Send queued staff Telegram messages right after the current response (security events, admin actions). */
export function telegramSoon() {
  if (!TELEGRAM_GROUPS.some((g) => groupConfig(g))) return;
  after(async () => {
    try {
      await dispatchNotifications(20);
    } catch (e) {
      console.error("[telegram] dispatch failed:", (e as Error).message);
    }
  });
}

/**
 * Delivery monitor: while staff, courier or shop apps are open, check for late deliveries (the database runs the
 * check at most every 5 minutes) and send any new alert. After the response; never delays the page.
 */
export async function deliveryMonitorSoon() {
  // The signed-in client is made now (cookies cannot be read inside after()); the check itself runs after the response.
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient().catch(() => null);
  if (!supabase) return;
  after(async () => {
    try {
      const { data } = await supabase.rpc("delivery_monitor_tick");
      if (Number(data ?? 0) > 0) await dispatchNotifications(20);
    } catch (e) {
      console.error("[monitor] tick failed:", (e as Error).message);
    }
  });
}

/** Send queued notifications (staff Telegram + customer emails + phone notifications + receipt archive) right after the current response (does not delay the user). */
export function dispatchSoon() {
  after(async () => {
    const [tg, mail, push, archive] = await Promise.allSettled([dispatchNotifications(), dispatchCustomerEmails(), dispatchCustomerPush(), dispatchReceiptArchive()]);
    if (tg.status === "rejected") console.error("[telegram] dispatch failed:", (tg.reason as Error).message);
    if (mail.status === "rejected") console.error("[email] dispatch failed:", (mail.reason as Error).message);
    if (push.status === "rejected") console.error("[push] dispatch failed:", (push.reason as Error).message);
    if (archive.status === "rejected") console.error("[archive] dispatch failed:", (archive.reason as Error).message);
    // Copies of the customer messages just sent go to Telegram too.
    await dispatchNotifications().catch((e: Error) => console.error("[telegram] dispatch failed:", e.message));
    // Printing documents of cancelled / rejected jobs: deleted once their Telegram copy has gone out.
    await deleteDuePrintingFilesQuietly();
  });
}
