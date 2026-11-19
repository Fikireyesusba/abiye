"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

/** Effectively permanent; reactivation lifts it. */
const BAN_DURATION = "876000h";

/**
 * Every action here: (1) requires customers.manage, (2) is rate limited per
 * admin, (3) validates the target through permission-checked SQL (refuses
 * staff accounts) BEFORE the secret-key client touches Supabase Auth, and
 * (4) is recorded in the audit log.
 */
async function guard(kind: string) {
  const ctx = await requirePermission("customers.manage");
  if (!(await rateLimit(`admin:customers:${kind}:${ctx.userId}`, 30, 3600))) return { ctx, limited: true as const };
  return { ctx, limited: false as const };
}

async function loadAccount(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_customer_accounts", { p_user_id: userId, p_limit: 1 });
  return { supabase, account: data?.[0] ?? null, error };
}

const userIdSchema = z.object({ userId: z.guid() });

export async function sendCustomerPasswordReset(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { limited } = await guard("reset");
  if (limited) return fail("Too many requests. Try again later.");
  const parsed = userIdSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const { supabase, account } = await loadAccount(parsed.data.userId);
  if (!account) return fail("Customer not found.");
  if (account.is_staff) return fail("Staff accounts are managed under Staff.");
  if (account.deactivated_at) return fail("Reactivate the account first.");
  if (!account.email_confirmed_at) return fail("This account is not confirmed yet — resend the invitation instead.");

  const { error } = await getSupabaseAdmin().auth.resetPasswordForEmail(account.email);
  if (error) {
    console.warn(`[admin-customers] reset email failed: ${error.code ?? error.status ?? "unknown"}`);
    return fail(error.status === 429 ? "Email limit reached. Try again in a few minutes." : "Could not send the email.");
  }
  await supabase.rpc("admin_log_customer_action", { p_user_id: account.id, p_action: "password_reset_sent", p_metadata: {} });
  revalidatePath(`/admin/customers/${account.id}`);
  return ok(`Password reset email sent to ${account.email}.`);
}

const inviteSchema = z.object({
  email: z.email().max(254),
  fullName: z.string().trim().max(120).optional().transform((v) => v || undefined),
});

export async function inviteCustomer(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { limited } = await guard("invite");
  if (limited) return fail("Too many invitations. Try again later.");
  const parsed = inviteSchema.safeParse({ ...formObject(fd), email: String(fd.get("email") ?? "").trim().toLowerCase() });
  if (!parsed.success) return fail("Enter a valid email address.");
  const { email, fullName } = parsed.data;
  return sendInvite(email, fullName);
}

/** Resend the invitation to an account that has not been confirmed yet. */
export async function resendCustomerInvite(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { limited } = await guard("invite");
  if (limited) return fail("Too many invitations. Try again later.");
  const parsed = userIdSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const { account } = await loadAccount(parsed.data.userId);
  if (!account) return fail("Customer not found.");
  if (account.is_staff) return fail("Staff accounts are managed under Staff.");
  if (account.email_confirmed_at) return fail("This account is already confirmed — send a password reset instead.");
  if (account.deactivated_at) return fail("Reactivate the account first.");
  return sendInvite(account.email, account.full_name ?? undefined);
}

async function sendInvite(email: string, fullName: string | undefined): Promise<ActionResult> {
  const { data, error } = await getSupabaseAdmin().auth.admin.inviteUserByEmail(email, {
    // The invite email template links to /auth/confirm, which leads to "set your password".
    data: fullName ? { full_name: fullName } : undefined,
  });
  if (error || !data.user) {
    console.warn(`[admin-customers] invite failed: ${error?.code ?? error?.status ?? "unknown"}`);
    if (error?.code === "email_exists" || /already/i.test(error?.message ?? "")) {
      return fail("An account with that email already exists and is confirmed. Send a password reset instead.");
    }
    return fail(error?.status === 429 ? "Email limit reached. Try again in a few minutes." : "Could not send the invitation.");
  }
  const supabase = await createSupabaseServerClient();
  const { error: logError } = await supabase.rpc("admin_log_customer_action", { p_user_id: data.user.id, p_action: "invite_sent", p_metadata: { email } });
  if (logError?.message === "cannot_manage_staff") return fail("That email belongs to a staff account.");
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${data.user.id}`);
  return ok(`Invitation sent to ${email}. They set their password from the email link.`);
}

const activeSchema = z.object({
  userId: z.guid(),
  active: z.enum(["true", "false"]),
  reason: z.string().trim().max(500).optional(),
});

export async function setCustomerActive(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { limited } = await guard("active");
  if (limited) return fail("Too many requests. Try again later.");
  const parsed = activeSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const active = parsed.data.active === "true";
  if (!active && !parsed.data.reason) return fail("Please enter a reason.");

  // Database first: it checks permission, refuses staff and records who/why.
  // From this moment ordering and access to the account's data are blocked.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_customer_active", {
    p_user_id: parsed.data.userId,
    p_active: active,
    p_reason: parsed.data.reason ?? undefined,
  });
  if (error) return dbError(error);

  // Then Supabase Auth: block (or allow again) signing in.
  const { error: banError } = await getSupabaseAdmin().auth.admin.updateUserById(parsed.data.userId, {
    ban_duration: active ? "none" : BAN_DURATION,
  });
  revalidatePath(`/admin/customers/${parsed.data.userId}`);
  revalidatePath("/admin/customers");
  if (banError) {
    console.error(`[admin-customers] ban update failed: ${banError.code ?? banError.status ?? "unknown"}`);
    return fail(active
      ? "Reactivated in the shop, but Supabase still blocks sign-in. Click Reactivate again."
      : "Deactivated (ordering is blocked), but the sign-in block failed. Click Deactivate again.");
  }
  return ok(active ? "Account reactivated." : "Account deactivated. The customer can no longer sign in or order.");
}

export async function deleteCustomer(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { limited } = await guard("delete");
  if (limited) return fail("Too many requests. Try again later.");
  const parsed = userIdSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  // Refuses staff and accounts with orders/printing jobs; returns what to keep in the log.
  const { data: snapshot, error } = await supabase.rpc("admin_prepare_customer_delete", { p_user_id: parsed.data.userId });
  if (error) return dbError(error);

  const { error: deleteError } = await getSupabaseAdmin().auth.admin.deleteUser(parsed.data.userId);
  if (deleteError) {
    console.error(`[admin-customers] delete failed: ${deleteError.code ?? deleteError.status ?? "unknown"}`);
    return fail("Could not delete the account.");
  }
  const meta = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
  await supabase.rpc("admin_log_customer_action", { p_user_id: parsed.data.userId, p_action: "customer_deleted", p_metadata: meta });
  revalidatePath("/admin/customers");
  redirect("/admin/customers?deleted=1");
}
