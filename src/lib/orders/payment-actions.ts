"use server";
import { toAppError, type AppErrorCode } from "@/lib/errors";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { paymentSubmissionSchema } from "@/lib/validation/checkout";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, validateUpload } from "@/lib/validation/upload";
import { getOrderForCustomer, isAccessToken, isGuid } from "./access";

const BUCKET = "payment-receipts";
const EXT_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" };
const PAYABLE = new Set(["awaiting_payment", "payment_rejected"]);

type Fail = { ok: false; error: AppErrorCode };

/**
 * Step 1 — issue a one-time signed upload URL for a server-chosen path in the
 * PRIVATE receipts bucket. The browser uploads directly to Storage (this keeps
 * large files off the 4.5 MB serverless request limit).
 */
export async function prepareReceiptUpload(input: {
  orderId: unknown;
  accessToken: unknown;
  mimeType: unknown;
  size: unknown;
}): Promise<{ ok: true; path: string; uploadToken: string } | Fail> {
  const { orderId, accessToken, mimeType, size } = input;
  if (!isGuid(orderId) || !isAccessToken(accessToken)) return { ok: false, error: "order_not_found" };
  if (typeof mimeType !== "string" || !(mimeType in EXT_BY_MIME)) return { ok: false, error: "upload_invalid_type" };
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return { ok: false, error: "upload_failed" };
  if (size > RECEIPT_MAX_BYTES) return { ok: false, error: "upload_too_large" };

  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`receipt:ip:${ip}`, 20, 3600], [`receipt:order:${orderId}`, 10, 3600]]))) {
    return { ok: false, error: "rate_limited" };
  }

  const order = await getOrderForCustomer(orderId, accessToken);
  if (!order) return { ok: false, error: "order_not_found" };
  if (!PAYABLE.has(order.status)) return { ok: false, error: "payment_not_allowed" };
  if (new Date(order.payment_due_at) < new Date()) return { ok: false, error: "order_expired" };

  const path = `orders/${orderId}/${crypto.randomUUID()}.${EXT_BY_MIME[mimeType]}`;
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[receipt] signed url failed:", error?.message);
    return { ok: false, error: "upload_failed" };
  }
  return { ok: true, path: data.path, uploadToken: data.token };
}

/**
 * Step 2 — verify the uploaded object BY CONTENT, then record the submission.
 * Anything that fails verification is deleted.
 */
export async function submitPaymentProof(input: {
  orderId: unknown;
  accessToken: unknown;
  path: unknown;
  transactionReference?: unknown;
  originalName?: unknown;
}): Promise<{ ok: true } | Fail> {
  const parsed = paymentSubmissionSchema.safeParse({
    orderId: input.orderId,
    accessToken: input.accessToken,
    transactionReference: input.transactionReference ?? "",
  });
  if (!parsed.success) {
    const refIssue = parsed.error.issues.some((i) => i.path[0] === "transactionReference");
    return { ok: false, error: refIssue ? "invalid_reference" : "order_not_found" };
  }
  const { orderId, accessToken, transactionReference } = parsed.data;
  const path = typeof input.path === "string" ? input.path : "";
  const pathMatch = path.match(new RegExp(`^orders/${orderId}/[0-9a-f-]{36}\\.(jpg|png|pdf)$`));
  if (!pathMatch) return { ok: false, error: "upload_failed" };

  if (!(await rateLimitAll([[`payment:order:${orderId}`, 10, 3600]]))) return { ok: false, error: "rate_limited" };

  const order = await getOrderForCustomer(orderId, accessToken);
  if (!order) return { ok: false, error: "order_not_found" };

  const storage = getSupabaseAdmin().storage.from(BUCKET);
  const discard = async () => {
    const { error } = await storage.remove([path]);
    if (error) console.error("[receipt] cleanup failed:", error.message);
  };

  const { data: blob, error: downloadError } = await storage.download(path);
  if (downloadError || !blob) return { ok: false, error: "upload_failed" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const check = validateUpload(bytes, { allowed: RECEIPT_TYPES, maxBytes: RECEIPT_MAX_BYTES });
  if (!check.ok || check.type !== MIME_BY_EXT[pathMatch[1]]) {
    await discard();
    return { ok: false, error: check.ok || check.reason === "unsupported_type" ? "upload_invalid_type" : check.reason === "too_large" ? "upload_too_large" : "upload_failed" };
  }

  const originalName = typeof input.originalName === "string" ? input.originalName.slice(0, 255) : null;
  const { error } = await getSupabaseAdmin().rpc("submit_payment", {
    p_input: {
      order_id: orderId,
      access_token_hash: sha256Hex(accessToken),
      transaction_reference: transactionReference ?? null,
      receipt: { path, mime: check.type, size: bytes.length, original_name: originalName, sha256: sha256Hex(bytes) },
    },
  });
  if (error) {
    await discard();
    const appError = toAppError(error);
    if (appError.code === "unexpected") console.error("[receipt] submit_payment failed:", error.code, error.message);
    return { ok: false, error: appError.code };
  }
  dispatchSoon(); // staff Telegram alert with the receipt, sent after this response
  return { ok: true };
}
