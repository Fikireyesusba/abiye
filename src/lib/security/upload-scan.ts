import "server-only";
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

/**
 * Scan one customer upload (after the content-type check). Clean → null. Otherwise the error code to show
 * the customer, and a security event (Admin → Security + security Telegram group) with the User ID,
 * where it was uploaded and what was found. The caller deletes the stored file.
 */
export async function scanCustomerUpload(
  bytes: Uint8Array,
  opts: { where: "payment_receipt" | "topup_receipt" | "printing_file"; userId: string | null; mime: string; ref?: string },
): Promise<null | "upload_rejected" | "scan_unavailable"> {
  const ext = EXT_OF[opts.mime] ?? [];
  const res = await scanFile(bytes, `upload${ext[0] ?? ""}`, ext);
  if (res.ok) return null;
  // The account's email links the event to the customer (User ID in alerts; risk score on the Security page).
  const email = opts.userId ? (await getSupabaseAdmin().auth.admin.getUserById(opts.userId).catch(() => null))?.data.user?.email ?? null : null;
  const metadata = { where: opts.where, file_type: ext[0]?.slice(1) ?? opts.mime, size_kb: Math.ceil(bytes.length / 1024), ...(opts.ref ? { ref: opts.ref } : {}) };
  if (res.reason === "infected") {
    await recordSecurityEvent("upload_blocked", { userId: opts.userId, email, metadata: { ...metadata, found: res.findings.slice(0, 5).join("; ") } });
    return "upload_rejected";
  }
  console.error(`[virus-scan] ${opts.where}: ${res.detail}`);
  await recordSecurityEvent("scan_unavailable", { userId: opts.userId, email, metadata: { ...metadata, problem: res.detail } });
  return "scan_unavailable";
}
