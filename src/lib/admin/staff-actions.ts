"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const role = z.enum(["super_admin", "manager", "staff"]);
const tempPassword = () => `${randomBytes(12).toString("base64url")}-Aa9`;

/**
 * Create a staff account. The auth user is created with the secret key ONLY
 * after the caller is verified to hold staff.manage; the admin profile itself
 * is granted through the caller's own session (permission-checked + audited).
 */
export async function inviteStaff(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("staff.manage");
  const parsed = z
    .object({ email: z.email().max(254), fullName: z.string().trim().min(1).max(120), role })
    .safeParse({ ...formObject(fd), email: String(fd.get("email") ?? "").trim().toLowerCase() });
  if (!parsed.success) return fail("Enter a valid email, name and role.");
  const { email, fullName, role: roleKey } = parsed.data;

  const password = tempPassword();
  const admin = getSupabaseAdmin();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) {
    return fail(/already|registered|exists/i.test(createError?.message ?? "") ? "An account with that email already exists." : "Could not create the account.");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_create_staff_profile", { p_user_id: created.user.id, p_full_name: fullName, p_role_key: roleKey });
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    return dbError(error);
  }
  revalidatePath("/admin/staff");
  return ok(`Account created for ${email}.\nTemporary password (shown once — share it privately): ${password}\nAsk them to change it under “My account” after signing in.`);
}

export async function updateStaff(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("staff.manage");
  const parsed = z.object({ userId: z.guid(), role, active: z.enum(["true", "false"]) }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_staff_role", {
    p_user_id: parsed.data.userId,
    p_role_key: parsed.data.role,
    p_is_active: parsed.data.active === "true",
  });
  if (error) return dbError(error);
  // No session revocation needed: every page/action and every RLS policy checks
  // profiles.is_active on each request, so access ends immediately.
  revalidatePath("/admin/staff");
  return ok(parsed.data.active === "true" ? "Staff member updated." : "Access removed.");
}

export async function resetStaffPassword(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("staff.manage");
  const userId = z.guid().safeParse(fd.get("userId"));
  if (!userId.success) return fail("Invalid request.");
  if (userId.data === ctx.userId) return fail("Change your own password under “My account”.");
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", userId.data).maybeSingle();
  if (!profile) return fail("Staff member not found.");
  const password = tempPassword();
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId.data, { password });
  if (error) return fail("Could not reset the password.");
  return ok(`New temporary password (shown once): ${password}`);
}

/** Lost phone: remove a staff member's authenticator; they set up a new one at the next sign-in. */
export async function resetStaffMfa(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("staff.manage");
  const userId = z.guid().safeParse(fd.get("userId"));
  if (!userId.success) return fail("Invalid request.");
  if (userId.data === ctx.userId) return fail("You cannot reset your own two-step login.");
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", userId.data).maybeSingle();
  if (!profile) return fail("Staff member not found.");
  const admin = getSupabaseAdmin();
  const { data: factors, error } = await admin.auth.admin.mfa.listFactors({ userId: userId.data });
  if (error) return fail("Could not read their two-step login.");
  for (const f of factors?.factors ?? []) {
    const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: userId.data });
    if (delError) return fail("Could not reset their two-step login.");
  }
  const { error: logError } = await supabase.rpc("admin_log_mfa_reset", { p_user_id: userId.data });
  if (logError) console.error("[staff] mfa reset audit failed:", logError.message);
  revalidatePath("/admin/staff");
  return ok("Two-step login reset. They will set it up again at their next sign-in.");
}

/**
 * Delete a staff member for good (Super Admin). The database marks them removed
 * (no access, cannot be switched back on, open work unassigned) and keeps their
 * name for the history; then their sign-in is blocked with the secret key.
 */
export async function removeStaff(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("staff.manage");
  const userId = z.guid().safeParse(fd.get("userId"));
  if (!userId.success) return fail("Invalid request.");
  if (userId.data === ctx.userId) return fail("You cannot delete your own account.");
  const supabase = await createSupabaseServerClient();
  const { data: name, error } = await supabase.rpc("admin_remove_staff", { p_user_id: userId.data });
  if (error) return dbError(error);
  // Only after the permission-checked database step above succeeded.
  const { error: banError } = await getSupabaseAdmin().auth.admin.updateUserById(userId.data, { ban_duration: "876000h" });
  revalidatePath("/admin/staff");
  if (banError) {
    console.error("[staff] sign-in block failed:", banError.message);
    return ok(`${name} was removed and has no dashboard access. (Their sign-in could not be blocked right now — they still cannot open the dashboard.)`);
  }
  return ok(`${name} was deleted. They can no longer sign in, and their open orders and printing jobs are unassigned.`);
}
