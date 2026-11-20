"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const BAN = "876000h";

/** Super Admin: block an email everywhere (sign-up, sign-in, ordering). An existing customer account is deactivated and banned. */
export async function blockEmail(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("security.manage");
  const parsed = z.object({ email: z.email().max(254), reason: z.string().trim().min(2).max(500) })
    .safeParse({ ...formObject(fd), email: String(fd.get("email") ?? "").trim().toLowerCase() });
  if (!parsed.success) return fail("Enter the email and a reason.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_block_email", { p_email: parsed.data.email, p_reason: parsed.data.reason });
  if (error) return error.message === "cannot_manage_staff" ? fail("That is a staff account — remove its access under Staff instead.") : dbError(error);
  const userId = (data as { user_id: string | null }).user_id;
  if (userId) {
    const { error: banError } = await getSupabaseAdmin().auth.admin.updateUserById(userId, { ban_duration: BAN });
    if (banError) console.error("[security] ban failed:", banError.code ?? banError.status);
  }
  revalidatePath("/admin/security");
  return ok(userId ? `Blocked ${parsed.data.email}. The account was deactivated and cannot sign in.` : `Blocked ${parsed.data.email}. It cannot be used to sign up or sign in.`);
}

export async function unblockEmail(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("security.manage");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_unblock_email", { p_email: email });
  if (error) return dbError(error);
  const userId = (data as { reactivated_user_id: string | null }).reactivated_user_id;
  if (userId) await getSupabaseAdmin().auth.admin.updateUserById(userId, { ban_duration: "none" });
  revalidatePath("/admin/security");
  return ok(userId ? `Unblocked ${email} and reactivated the account.` : `Unblocked ${email}.`);
}

/**
 * Super Admin: clear alerts ("mark as reviewed"). One email / customer, or everything currently listed.
 * It disappears from the lists and the red badge and comes back only on new activity.
 */
export async function markSecurityReviewed(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("security.manage");
  const type = fd.get("type") === "customer" ? "customer" : fd.get("type") === "email" ? "email" : null;
  if (!type) return fail("Invalid request.");
  const note = String(fd.get("note") ?? "").trim().slice(0, 500) || undefined;
  const supabase = await createSupabaseServerClient();
  let subjects: string[];
  if (fd.get("all") === "1") {
    const { data, error } = type === "email"
      ? await supabase.rpc("admin_suspicious_emails", { p_days: 7 }).then((r) => ({ data: (r.data ?? []).filter((x) => !x.blocked).map((x) => x.email), error: r.error }))
      : await supabase.rpc("admin_suspicious_customers", { p_days: 30 }).then((r) => ({ data: (r.data ?? []).map((x) => x.user_id), error: r.error }));
    if (error) return dbError(error);
    subjects = data;
  } else {
    const one = String(fd.get("subject") ?? "").trim();
    const valid = type === "email" ? z.email().max(254).safeParse(one.toLowerCase()).success : z.guid().safeParse(one).success;
    if (!valid) return fail("Invalid request.");
    subjects = [one];
  }
  if (!subjects.length) return ok("Nothing to clear.");
  const { data, error } = await supabase.rpc("admin_mark_security_reviewed", { p_type: type, p_subjects: subjects.slice(0, 500), p_note: note });
  if (error) return dbError(error);
  revalidatePath("/admin", "layout"); // red badge
  const n = Number(data ?? 0);
  return ok(`${n} alert${n === 1 ? "" : "s"} cleared. ${n === 1 ? "It" : "They"} will show again only if something new happens.`);
}
