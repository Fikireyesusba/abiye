import { toAppError } from "@/lib/errors";

/** Uniform result for admin server actions (rendered by <ActionMessage/>). */
export type ActionResult = { ok: true; message?: string; at?: number } | { ok: false; error: string; at?: number };

export const ok = (message?: string): ActionResult => ({ ok: true, message, at: Date.now() });
export const fail = (error: string): ActionResult => ({ ok: false, error, at: Date.now() });

/** Human-readable admin error from a Postgres/PostgREST error. Never leaks SQL details. */
export function dbError(error: { code?: string; message?: string; details?: string | null } | null): ActionResult {
  if (!error) return fail("Unknown error");
  if (error.code === "23505") return fail("That value is already used (must be unique).");
  if (error.code === "23503") return fail("This item is referenced by other records and cannot be removed. Archive or deactivate it instead.");
  if (error.code === "23514") return fail("A value is outside the allowed range or format.");
  if (error.code === "42501") return fail("You do not have permission to do that.");
  const app = toAppError(error);
  if (app.code !== "unexpected") return fail(ADMIN_MESSAGES[app.code] ?? app.code.replaceAll("_", " "));
  console.error("[admin] db error:", error.code, error.message);
  return fail("Something went wrong. Please try again.");
}

const ADMIN_MESSAGES: Record<string, string> = {
  forbidden: "You do not have permission to do that.",
  not_found: "Not found (or not visible to your role).",
  invalid_transition: "That status change is not allowed from the current status.",
  note_required: "Please enter a reason.",
  already_reviewed: "This payment was already reviewed.",
  insufficient_stock: "Not enough stock for that adjustment.",
  cannot_modify_self: "You cannot change your own role or status.",
  last_super_admin: "At least one active Super Admin is required.",
  invalid_parent_category: "The parent must be a top-level category in the same department.",
  service_unavailable: "This service is paused (Admin → Manage services).",
  product_unavailable: "A product is no longer available.",
  invalid_quantity: "Check the quantities (1–1000).",
  invalid_amount: "Check the amount (the discount must be lower than the total).",
  invalid_reason: "Please give a reason (5–300 characters).",
  promo_in_use: "This promotion was used (or an order waiting for payment has it). Revoke it instead — it stays in the records.",
  promo_has_customers: "This code is given to customers. Remove it from each customer first.",
};

/** FormData → plain object of strings (files excluded). */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  // The website is English only: an Amharic field (…_am) the form no longer shows gets the English text.
  for (const k of Object.keys(out)) {
    if (!k.endsWith("_en")) continue;
    const am = `${k.slice(0, -3)}_am`;
    if (!out[am]?.trim()) out[am] = out[k];
  }
  return out;
}
