/**
 * Stable error codes raised by database functions via private.app_error().
 * The UI translates them with messages/<locale>.json -> "errors.<code>".
 * Unknown errors are reported as "unexpected" (details are logged server-side
 * only, never shown to customers).
 */
export const APP_ERROR_CODES = [
  "forbidden", "not_found", "invalid_request", "idempotency_conflict", "invalid_name", "invalid_phone",
  "invalid_fulfillment", "invalid_cart", "invalid_quantity", "product_unavailable", "out_of_stock",
  "printing_job_not_found", "printing_job_not_payable", "pickup_unavailable", "delivery_unavailable",
  "invalid_delivery_zone", "invalid_address", "invalid_instructions", "no_bank_account",
  "order_not_found", "payment_already_pending", "payment_not_allowed", "order_expired",
  "invalid_files", "too_many_copies", "already_reviewed", "note_required", "invalid_decision",
  "invalid_transition", "invalid_assignee", "invalid_reason", "insufficient_stock", "invalid_page_count",
  "no_price_rule", "invalid_amount", "cancel_order_instead", "invalid_role", "cannot_modify_self",
  "last_super_admin", "super_admin_exists", "user_not_found", "invalid_parent_category",
  "rate_limited", "invalid_reference", "upload_too_large", "upload_invalid_type", "upload_failed", "login_required", "terms_required", "account_deactivated", "cannot_manage_staff", "has_orders", "unexpected",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "AppError";
  }
}

const known = new Set<string>(APP_ERROR_CODES);

/** Convert a PostgREST / Postgres error into an AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; details?: unknown };
    if (e.code === "P0001" && typeof e.message === "string" && known.has(e.message)) {
      return new AppError(e.message as AppErrorCode, typeof e.details === "string" && e.details ? e.details : undefined);
    }
  }
  return new AppError("unexpected");
}
