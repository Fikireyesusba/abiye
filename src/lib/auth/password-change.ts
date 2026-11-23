"use server";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { roleAllowedOn, surfaceForHost } from "@/lib/security/hosts";
import { ACTIVE_COOKIE, SESSION_COOKIE } from "@/lib/security/idle";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { isEmailBlocked, recordSecurityEvent } from "@/lib/security/events";
import { sha256Hex } from "@/lib/security/tokens";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PasswordChangeState = { error?: string; done?: boolean; email?: string };

const GENERIC = "Email, current password or code is not correct.";
const schema = z.object({
  email: z.email().max(254),
  current: z.string().min(1).max(200),
  code: z.string().trim().regex(/^\d{6}$/),
  password: z.string().min(12).max(200),
  confirm: z.string().max(200),
});

/**
 * Staff / admin / courier change their password without being signed in:
 * email + current password + authenticator code + new password (twice).
 * Afterwards the account is signed out everywhere (every device signs in again with the new password).
 */
export async function changeStaffPassword(_prev: PasswordChangeState, fd: FormData): Promise<PasswordChangeState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const v = schema.safeParse({ email, current: fd.get("current"), code: fd.get("code"), password: fd.get("password"), confirm: fd.get("confirm") });
  if (!v.success) {
    const field = v.error.issues[0]?.path[0];
    if (field === "code") return { error: "Enter the 6-digit code from your authenticator app.", email };
    if (field === "password") return { error: "The new password needs at least 12 characters with upper-case, lower-case letters and a number.", email };
    return { error: GENERIC, email };
  }
  const { current, code, password, confirm } = v.data;
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return { error: "The new password needs at least 12 characters with upper-case, lower-case letters and a number.", email };
  }
  if (password !== confirm) return { error: "The two new passwords do not match.", email };
  if (password === current) return { error: "Choose a new password that is different from the current one.", email };

  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`pwchange:ip:${ip}`, 10, 900], [`pwchange:email:${sha256Hex(email).slice(0, 32)}`, 5, 900]]))) {
    await recordSecurityEvent("rate_limited", { email, metadata: { where: "staff_password_change" } });
    return { error: "Too many attempts. Please wait 15 minutes and try again.", email };
  }
  if (await isEmailBlocked(email)) return { error: GENERIC, email };

  const supabase = await createSupabaseServerClient();
  const bail = async (msg: string) => {
    await supabase.auth.signOut({ scope: "local" });
    return { error: msg, email };
  };
  // 1. current password
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: current });
  if (signInError) {
    await recordSecurityEvent("admin_login_failed", { email, metadata: { where: "staff_password_change" } });
    return { error: GENERIC, email };
  }
  // 2. a staff account, at its own address
  const { data: status } = await supabase.rpc("my_staff_status");
  const st = status as { staff?: boolean; role?: string | null } | null;
  if (!st?.staff) {
    await recordSecurityEvent("admin_login_not_staff", { email, metadata: { where: "staff_password_change" } });
    return bail(GENERIC);
  }
  if (st.role && !roleAllowedOn(surfaceForHost((await headers()).get("host")), st.role)) {
    return bail("This account changes its password at its own sign-in address.");
  }
  // 3. authenticator code (a stolen password alone cannot change it)
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = factors?.totp.find((f) => f.status === "verified")?.id;
  if (!factorId) return bail("Sign in once first to set up your two-step login, then change your password.");
  const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (mfaError) {
    await recordSecurityEvent("admin_mfa_failed", { email, metadata: { where: "staff_password_change" } });
    return bail(GENERIC);
  }
  // 4. new password, then signed out everywhere
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    console.warn(`[password-change] update failed: ${updateError.code ?? updateError.status ?? "unknown"}`);
    return bail(updateError.code === "weak_password" ? "That password is too weak or too common. Choose another one." : "Could not change the password. Please try again.");
  }
  await supabase.auth.signOut({ scope: "global" });
  const jar = await cookies();
  jar.delete(ACTIVE_COOKIE);
  jar.delete(SESSION_COOKIE);
  return { done: true, email };
}
