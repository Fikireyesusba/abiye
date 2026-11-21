"use server";
import { ACTIVE_COOKIE, SESSION_COOKIE } from "@/lib/security/idle";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/tokens";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailBlocked, recordSecurityEvent } from "@/lib/security/events";
import { isStaffAccount } from "./mfa";
import { safeAdminRedirect } from "./safe-redirect";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) });
const GENERIC = "Incorrect email or password.";

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const parsed = loginSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: GENERIC, email };

  const ip = await clientIpKey();
  const allowed = await rateLimitAll([
    [`login:ip:${ip}`, 20, 900],
    [`login:email:${sha256Hex(email).slice(0, 32)}`, 5, 900],
  ]);
  if (!allowed) {
    await recordSecurityEvent("rate_limited", { email, metadata: { where: "admin_login" } });
    return { error: "Too many sign-in attempts. Please wait 15 minutes and try again.", email };
  }

  // Blocked email: refused quietly, without trying the password (no alert, no event).
  if (await isEmailBlocked(email)) return { error: "You're not allowed to use this website.", email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Visitors get one generic message; the server log keeps the real reason (never the password).
    console.warn(`[admin-login] failed: ${error.code ?? "unknown"} (status ${error.status ?? "?"})`);
    await recordSecurityEvent("admin_login_failed", { email, metadata: { code: error.code ?? "unknown" } });
    return { error: GENERIC, email };
  }

  // Valid Supabase user but not an active staff member: sign straight back out.
  if (!(await isStaffAccount(supabase))) {
    await recordSecurityEvent("admin_login_not_staff", { email });
    console.warn("[admin-login] signed in but no active staff profile (run bootstrap_super_admin / add in /admin/staff)");
    await supabase.auth.signOut();
    return { error: "This account does not have access to the admin dashboard.", email };
  }
  // Second step: the authenticator code (or setting one up on first sign-in).
  redirect(`/admin/mfa?next=${encodeURIComponent(safeAdminRedirect(formData.get("next")))}`);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const jar = await cookies();
  jar.delete(ACTIVE_COOKIE);
  jar.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

export type PasswordState = { error?: string; ok?: boolean };

/** Signed-in staff change their own password (e.g. after receiving a temporary one). */
export async function changePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return { error: "Use at least 12 characters with upper-case, lower-case letters and a number." };
  }
  if (password !== confirm) return { error: "The passwords do not match." };
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/admin/login");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not change password. Please sign in again and retry." };
  return { ok: true };
}
