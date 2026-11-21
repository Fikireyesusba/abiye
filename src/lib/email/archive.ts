import "server-only";
import { getSiteSettings } from "@/lib/catalog/settings";
import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { emailConfigured } from "./dispatch";
import { APP_TIME_LABEL, zoneStamp } from "@/lib/datetime";

/**
 * Receipt archive: every verified / rejected payment receipt (orders and wallet top-ups) is emailed,
 * with the receipt attached, to the business's archive address (Admin → Notifications).
 * Rows are queued by the database in the same transaction as the decision; never dropped for age.
 */

export interface ArchivePayload {
  kind?: string;
  result?: string;
  number?: string;
  amount_etb?: number | string;
  order_total_etb?: number | string | null;
  reference?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  submitted_at?: string | null;
  decided_at?: string | null;
  decided_by?: string | null;
  reason?: string | null;
  receipt_name?: string | null;
  receipt_mime?: string | null;
  receipt_sha256?: string | null;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const etb = (v: unknown) => (v === null || v === undefined || v === "" ? "" : `${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`);
const addis = (iso: unknown) => (typeof iso !== "string" || !iso ? "" : `${zoneStamp(iso)} (${APP_TIME_LABEL})`);
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/** Subject, body and attachment file name for one archived receipt. Pure; all values escaped. */
export function buildArchiveEmail(p: ArchivePayload, business: string, attachmentMissing = false) {
  const kind = p.kind === "wallet_topup" ? "Wallet top-up" : "Order payment";
  const result = p.result === "verified" ? "VERIFIED" : p.result === "rejected" ? "REJECTED" : String(p.result ?? "").toUpperCase();
  const subject = `[Receipt archive] ${result} · ${p.number ?? ""} · ${etb(p.amount_etb)}${p.reference ? ` · ${p.reference}` : ""}`;
  const rows: [string, string][] = [
    ["Result", result],
    ["Type", kind],
    [p.kind === "wallet_topup" ? "Top-up" : "Order", p.number ?? ""],
    ["Amount", etb(p.amount_etb)],
    ...(p.order_total_etb != null && p.kind !== "wallet_topup" ? [["Order total", etb(p.order_total_etb)] as [string, string]] : []),
    ["Bank reference", p.reference ?? "—"],
    ["Paid into", [p.bank_name, p.account_number].filter(Boolean).join(" · ") || "—"],
    ["Customer", [p.customer_name, p.customer_phone, p.customer_email].filter(Boolean).join(" · ") || "—"],
    ["Receipt uploaded", addis(p.submitted_at)],
    ["Decided", addis(p.decided_at)],
    ["Decided by", p.decided_by ?? "—"],
    ...(p.reason ? [["Reason", p.reason] as [string, string]] : []),
    ["Receipt file", `${p.receipt_name ?? "receipt"}${attachmentMissing ? " (file no longer stored — not attached)" : " (attached)"}`],
    ["Receipt fingerprint (SHA-256)", p.receipt_sha256 ?? ""],
  ];
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">
<h2 style="margin:0 0 12px">${esc(business)} — payment receipt archive</h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="border:1px solid #ddd;background:#f6f6f6;font-weight:bold">${esc(k)}</td><td style="border:1px solid #ddd">${esc(v)}</td></tr>`)
    .join("")}</table>
<p style="font-size:12px;color:#666">Automatic copy for your records. Keep this email; do not reply.</p></body></html>`;
  const text = `${business} — payment receipt archive\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nAutomatic copy for your records.`;
  const ext = EXT[p.receipt_mime ?? ""] ?? "bin";
  const filename = `${p.kind === "wallet_topup" ? "topup" : "payment"}-${(p.number ?? "receipt").replace(/[^A-Za-z0-9-]/g, "")}-${p.result ?? ""}.${ext}`;
  return { subject, html, text, filename };
}

type Sent = { ok: true } | { ok: false; permanent: boolean; error: string };

export async function sendArchiveEmail(
  to: string,
  mail: { subject: string; html: string; text: string },
  attachment: { filename: string; content: Buffer } | null,
  idempotencyKey: string,
): Promise<Sent> {
  const env = getServerEnv();
  try {
    const res = await fetch(`${env.EMAIL_API_BASE ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        from: env.EMAIL_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text,
        ...(attachment ? { attachments: [{ filename: attachment.filename, content: attachment.content.toString("base64") }] } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.text()).slice(0, 300);
    return { ok: false, permanent: res.status !== 429 && res.status < 500, error: `HTTP ${res.status}: ${body}` };
  } catch (e) {
    return { ok: false, permanent: false, error: (e as Error).message };
  }
}

export interface ArchiveSummary {
  configured: boolean;
  sent: number;
  failed: number;
}

/** Claim queued archive emails, attach the receipt from private storage, send, record the outcome. */
export async function dispatchReceiptArchive(limit = 10): Promise<ArchiveSummary> {
  if (!emailConfigured()) return { configured: false, sent: 0, failed: 0 };
  const db = getSupabaseAdmin();
  const { data: to, error: toError } = await db.rpc("receipt_archive_email");
  if (toError || !to) return { configured: false, sent: 0, failed: 0 }; // not set up (or migration missing): rows wait
  const { data: rows, error } = await db.rpc("claim_outbox", { p_channel: "archive", p_limit: limit });
  if (error) {
    console.error("[archive] claim failed:", error.message);
    return { configured: true, sent: 0, failed: 0 };
  }
  const summary: ArchiveSummary = { configured: true, sent: 0, failed: 0 };
  if (!rows?.length) return summary;
  const business = (await getSiteSettings()).business.name.en;

  for (const row of rows) {
    let attachment: { filename: string; content: Buffer } | null = null;
    const payload = (row.payload ?? {}) as ArchivePayload;
    let missing = false;
    if (row.attachment_bucket && row.attachment_path) {
      const { data: file, error: dlError } = await db.storage.from(row.attachment_bucket).download(row.attachment_path);
      if (file) attachment = { filename: "", content: Buffer.from(await file.arrayBuffer()) };
      else if (dlError && /not.?found|404/i.test(`${dlError.message} ${(dlError as { status?: number }).status ?? ""}`)) missing = true;
      else {
        await db.rpc("complete_notification", { p_id: row.id, p_success: false, p_error: `receipt download failed: ${dlError?.message ?? "unknown"}` });
        summary.failed++;
        continue;
      }
    }
    const mail = buildArchiveEmail(payload, business, missing);
    if (attachment) attachment.filename = mail.filename;
    const res = await sendArchiveEmail(to, mail, attachment, `archive-${row.id}`);
    if (!res.ok && res.permanent) {
      console.error(`[archive] permanent failure for outbox #${row.id}: ${res.error}`);
      await db.from("notifications_outbox").update({ status: "dead", last_error: res.error.slice(0, 1000), locked_until: null }).eq("id", row.id).eq("status", "processing");
      summary.failed++;
      continue;
    }
    await db.rpc("complete_notification", { p_id: row.id, p_success: res.ok, p_error: res.ok ? undefined : res.error });
    if (res.ok) summary.sent++;
    else summary.failed++;
  }
  return summary;
}
