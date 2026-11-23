"use server";
import { z } from "zod";
import { getCustomerUser } from "@/lib/account/session";
import { toAppError, type AppErrorCode } from "@/lib/errors";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, validateUpload } from "@/lib/validation/upload";
import { scanCustomerUpload } from "@/lib/security/upload-scan";
import { WALLET_MAX_ETB } from "./limits";

const BUCKET = "payment-receipts";
const EXT_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" };
const amountSchema = z.coerce.number().min(10).max(WALLET_MAX_ETB).refine((n) => Math.round(n * 100) === n * 100);

type Fail = { ok: false; error: AppErrorCode; detail?: string };

/** Step 1 — signed upload URL for the receipt, in the customer's own top-up folder. */
export async function prepareTopupUpload(input: { amount: unknown; mimeType: unknown; size: unknown }): Promise<{ ok: true; path: string; uploadToken: string } | Fail> {
  const user = await getCustomerUser();
  if (!user) return { ok: false, error: "login_required" };
  if (!amountSchema.safeParse(input.amount).success) return { ok: false, error: "invalid_amount" };
  if (typeof input.mimeType !== "string" || !(input.mimeType in EXT_BY_MIME)) return { ok: false, error: "upload_invalid_type" };
  if (typeof input.size !== "number" || !Number.isInteger(input.size) || input.size <= 0) return { ok: false, error: "upload_failed" };
  if (input.size > RECEIPT_MAX_BYTES) return { ok: false, error: "upload_too_large" };
  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`topup:ip:${ip}`, 20, 3600], [`topup:user:${user.id}`, 10, 3600]]))) return { ok: false, error: "rate_limited" };
  const path = `topups/${user.id}/${crypto.randomUUID()}.${EXT_BY_MIME[input.mimeType]}`;
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "upload_failed" };
  return { ok: true, path: data.path, uploadToken: data.token };
}

/** Step 2 — verify the receipt BY CONTENT, then record the top-up request (credited only after staff verify it). */
export async function submitTopup(input: { amount: unknown; path: unknown; transactionReference?: unknown }): Promise<{ ok: true; topupNumber: string } | Fail> {
  const user = await getCustomerUser();
  if (!user) return { ok: false, error: "login_required" };
  const amount = amountSchema.safeParse(input.amount);
  if (!amount.success) return { ok: false, error: "invalid_amount" };
  const ref = typeof input.transactionReference === "string" ? input.transactionReference.trim() : "";
  if (ref && !/^[A-Za-z0-9/_ -]{3,60}$/.test(ref)) return { ok: false, error: "invalid_reference" };
  const path = typeof input.path === "string" ? input.path : "";
  const m = path.match(new RegExp(`^topups/${user.id}/[0-9a-f-]{36}\\.(jpg|png|pdf)$`));
  if (!m) return { ok: false, error: "upload_failed" };
  if (!(await rateLimitAll([[`topup:submit:${user.id}`, 10, 3600]]))) return { ok: false, error: "rate_limited" };

  const storage = getSupabaseAdmin().storage.from(BUCKET);
  const discard = () => storage.remove([path]).then(() => undefined, () => undefined);
  const { data: blob } = await storage.download(path);
  if (!blob) return { ok: false, error: "upload_failed" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const check = validateUpload(bytes, { allowed: RECEIPT_TYPES, maxBytes: RECEIPT_MAX_BYTES });
  if (!check.ok || check.type !== MIME_BY_EXT[m[1]]) {
    await discard();
    return { ok: false, error: check.ok || check.reason === "unsupported_type" ? "upload_invalid_type" : check.reason === "too_large" ? "upload_too_large" : "upload_failed" };
  }
  // Virus scan (Cloudmersive) — refused if not clean or if the scan is unavailable.
  const scan = await scanCustomerUpload(bytes, { where: "topup_receipt", userId: user.id, mime: check.type });
  if (scan) {
    await discard();
    return { ok: false, error: scan };
  }
  const { data, error } = await getSupabaseAdmin().rpc("submit_wallet_topup", {
    p_user_id: user.id,
    p_input: {
      amount_etb: amount.data.toFixed(2),
      transaction_reference: ref || null,
      receipt: { path, mime: check.type, size: bytes.length, sha256: sha256Hex(bytes) },
    },
  });
  if (error || !data) {
    await discard();
    const e = toAppError(error);
    if (e.code === "unexpected") console.error("[wallet] submit_wallet_topup failed:", error?.code, error?.message);
    return { ok: false, error: e.code, detail: e.detail };
  }
  dispatchSoon(); // staff Telegram alert with the receipt
  return { ok: true, topupNumber: (data as { topup_number: string }).topup_number };
}
