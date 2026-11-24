"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { sendCustomerEmailNow } from "@/lib/email/dispatch";
import { rateLimitAll } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

/** Approve a new customer account: they can order straight away (and get an email). */
export async function approveCustomer(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("customers.approve");
  const v = z.object({ userId: z.guid() }).safeParse(formObject(fd));
  if (!v.success) return fail("Invalid request.");
  const { error } = await (await createSupabaseServerClient()).rpc("admin_approve_customer", { p_user_id: v.data.userId });
  if (error) return error.message === "invalid_transition" ? fail("This account was already decided.") : dbError(error);
  dispatchSoon();
  revalidatePath("/admin/approvals");
  return ok("Approved — the customer has been emailed and can order now.");
}

/**
 * Reject: the database blocks the email (with the reason) and logs it; then the customer is emailed
 * ("due to security reasons…") and the account is deleted with the secret key — only after that check passed.
 */
export async function rejectCustomer(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("customers.approve");
  const v = z.object({ userId: z.guid(), reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500) }).safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues.find((i) => i.path[0] === "reason")?.message ?? "Invalid request.");
  if (!(await rateLimitAll([[`reject-account:${ctx.userId}`, 60, 3600]]))) return fail("Too many requests. Try again later.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_reject_customer", { p_user_id: v.data.userId, p_reason: v.data.reason });
  if (error) {
    if (error.message === "invalid_transition") return fail("This account was already decided.");
    if (error.message === "has_orders") return fail("This account has orders or top-ups — deactivate it under Customers instead.");
    return dbError(error);
  }
  const info = data as { email: string; name: string | null };
  const emailed = await sendCustomerEmailNow(info.email, "customer_account_rejected", { reason: v.data.reason, name: info.name }, `account-rejected-${v.data.userId}`);
  const { error: deleteError } = await getSupabaseAdmin().auth.admin.deleteUser(v.data.userId);
  if (deleteError) {
    console.error(`[approvals] delete failed: ${deleteError.code ?? deleteError.status ?? "unknown"}`);
    return fail("The email is blocked, but the account could not be deleted — delete it under Customers.");
  }
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/customers");
  return ok(`Rejected — account deleted and email blocked.${emailed ? " The customer has been emailed." : " (The email to the customer could not be sent.)"}`);
}
