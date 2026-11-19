import "server-only";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env";
import { dispatchCustomerEmails } from "@/lib/email/dispatch";
import { dispatchCustomerPush } from "@/lib/push/dispatch";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendMedia, sendMessage, type SendResult, type TelegramConfig } from "./client";
import { buildMessage, CAPTION_LIMIT, MESSAGE_LIMIT, truncate, type OutboxRow } from "./format";

const ATTACHMENT_BUCKETS = new Set(["payment-receipts"]);

export function telegramConfig(): TelegramConfig | null {
  const env = getServerEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID) return null;
  return { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ADMIN_CHAT_ID, apiBase: env.TELEGRAM_API_BASE ?? "https://api.telegram.org" };
}

async function deliver(cfg: TelegramConfig, row: OutboxRow): Promise<SendResult> {
  const msg = buildMessage(row, getServerEnv().APP_URL);
  if (msg.attachment && ATTACHMENT_BUCKETS.has(msg.attachment.bucket) && msg.text.length <= CAPTION_LIMIT) {
    const { data: blob } = await getSupabaseAdmin().storage.from(msg.attachment.bucket).download(msg.attachment.path);
    if (blob) {
      const ext = msg.attachment.path.split(".").pop() ?? "bin";
      const isImage = ext === "jpg" || ext === "png";
      // Photos are previewed inline in the chat; Telegram rejects photos > 10 MB, so send those as documents.
      const kind = isImage && blob.size <= 10 * 1024 * 1024 ? "photo" : "document";
      const res = await sendMedia(cfg, kind, blob, `receipt-${row.payload.order_number ?? row.id}.${ext}`, msg.text);
      // A photo Telegram cannot process (e.g. odd dimensions) is retried once as a document.
      if (!res.ok && res.kind === "permanent" && kind === "photo") {
        return sendMedia(cfg, "document", blob, `receipt-${row.payload.order_number ?? row.id}.${ext}`, msg.text);
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
  const cfg = telegramConfig();
  if (!cfg) return { configured: false, sent: 0, failed: 0 };
  const db = getSupabaseAdmin();
  const { data: rows, error } = await db.rpc("claim_notifications", { p_limit: limit });
  if (error) {
    console.error("[telegram] claim failed:", error.message);
    return { configured: true, sent: 0, failed: 0 };
  }
  const summary: DispatchSummary = { configured: true, sent: 0, failed: 0 };
  let rateLimited: string | null = null;
  for (const row of (rows ?? []) as OutboxRow[]) {
    const res: SendResult = rateLimited ? { ok: false, kind: "retry", error: rateLimited } : await deliver(cfg, row);
    if (!res.ok && res.kind === "rate_limited") rateLimited = `rate limited by Telegram (retry after ${res.retryAfter}s)`;
    if (!res.ok && res.kind === "permanent") console.error(`[telegram] permanent failure for outbox #${row.id}: ${res.error}`);
    await db.rpc("complete_notification", { p_id: row.id, p_success: res.ok, p_error: res.ok ? undefined : res.error });
    if (res.ok) summary.sent++;
    else summary.failed++;
  }
  return summary;
}

/** Send queued notifications (staff Telegram + customer emails + phone notifications) right after the current response (does not delay the user). */
export function dispatchSoon() {
  after(async () => {
    const [tg, mail, push] = await Promise.allSettled([dispatchNotifications(), dispatchCustomerEmails(), dispatchCustomerPush()]);
    if (tg.status === "rejected") console.error("[telegram] dispatch failed:", (tg.reason as Error).message);
    if (mail.status === "rejected") console.error("[email] dispatch failed:", (mail.reason as Error).message);
    if (push.status === "rejected") console.error("[push] dispatch failed:", (push.reason as Error).message);
  });
}
