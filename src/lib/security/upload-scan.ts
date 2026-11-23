import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { recordSecurityEvent } from "./events";
import { scanFile } from "./virus-scan";

const EXT_OF: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};
type Source = "payment_receipt" | "topup_receipt" | "printing_file";

/**
 * Scan one customer upload (after the content-type check). Clean → null. Otherwise the error code to show
 * the customer, and a security event (Admin → Security + security Telegram group) with the User ID,
 * where it was uploaded and what was found. The caller deletes the stored file.
 * Every scan (clean or not) is kept in upload_scans (Admin → Security → File scans), matched to the
 * payment / top-up / printing file by its fingerprint (sha256).
 */
export async function scanCustomerUpload(
  bytes: Uint8Array,
  opts: { where: Source; userId: string | null; mime: string; ref?: string },
): Promise<null | "upload_rejected" | "scan_unavailable"> {
  const ext = EXT_OF[opts.mime] ?? [];
  const started = Date.now();
  const res = await scanFile(bytes, `upload${ext[0] ?? ""}`, ext);
  const fileType = ext[0]?.slice(1) ?? opts.mime;
  await logScan(bytes, opts, fileType, res.ok ? "clean" : res.reason === "infected" ? "blocked" : "unavailable",
    res.ok ? null : res.reason === "infected" ? res.findings.slice(0, 5).join("; ") : res.detail, Date.now() - started);
  if (res.ok) return null;
  // The account's email links the event to the customer (User ID in alerts; risk score on the Security page).
  const email = opts.userId ? (await getSupabaseAdmin().auth.admin.getUserById(opts.userId).catch(() => null))?.data.user?.email ?? null : null;
  const metadata = { where: opts.where, file_type: fileType, size_kb: Math.ceil(bytes.length / 1024), ...(opts.ref ? { ref: opts.ref } : {}) };
  if (res.reason === "infected") {
    await recordSecurityEvent("upload_blocked", { userId: opts.userId, email, metadata: { ...metadata, found: res.findings.slice(0, 5).join("; ") } });
    return "upload_rejected";
  }
  console.error(`[virus-scan] ${opts.where}: ${res.detail}`);
  await recordSecurityEvent("scan_unavailable", { userId: opts.userId, email, metadata: { ...metadata, problem: res.detail } });
  return "scan_unavailable";
}

/** Scan history row. Never blocks the upload decision if it cannot be written. */
async function logScan(bytes: Uint8Array, opts: { where: Source; userId: string | null; ref?: string }, fileType: string,
  result: "clean" | "blocked" | "unavailable", findings: string | null, durationMs: number) {
  const { error } = await getSupabaseAdmin().rpc("record_upload_scan", {
    p_user_id: opts.userId as string, p_source: opts.where, p_ref: (opts.ref ?? null) as string, // null allowed (guest / no reference)
    p_file_type: fileType,
    p_size: bytes.length, p_sha256: createHash("sha256").update(bytes).digest("hex"), p_result: result,
    p_findings: findings ?? undefined, p_duration_ms: durationMs,
  });
  if (error) console.error("[virus-scan] scan history not recorded:", error.message);
}
