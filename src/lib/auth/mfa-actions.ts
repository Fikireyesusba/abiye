"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordSecurityEvent } from "@/lib/security/events";
import { getMfaState } from "./mfa";
import { safeAdminRedirect } from "./safe-redirect";

export type MfaFormState = { error?: string };
const code = z.string().trim().regex(/^\d{6}$/);

async function currentEmail(): Promise<string | null> {
  const { data } = await (await createSupabaseServerClient()).auth.getClaims();
  return typeof data?.claims?.email === "string" ? data.claims.email : null;
}

async function limited(userId: string) {
  const ip = await clientIpKey();
  return !(await rateLimitAll([[`mfa:user:${userId}`, 6, 900], [`mfa:ip:${ip}`, 30, 900]]));
}

/** Second step of the admin sign-in: the 6-digit code from the authenticator app. */
export async function verifyAdminCode(_prev: MfaFormState, fd: FormData): Promise<MfaFormState> {
  const state = await getMfaState();
  if (!state.userId) redirect("/admin/login");
  if (!state.staff || !state.factorId) return { error: "This account cannot use the admin dashboard." };
  const c = code.safeParse(fd.get("code"));
  if (!c.success) return { error: "Enter the 6-digit code from your authenticator app." };
  if (await limited(state.userId)) return { error: "Too many attempts. Please wait 15 minutes and try again." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code: c.data });
  if (error) {
    console.warn(`[admin-mfa] verify failed: ${error.code ?? error.status ?? "unknown"}`);
    await recordSecurityEvent("admin_mfa_failed", { userId: state.userId, email: await currentEmail() });
    return { error: "That code is not correct (or has expired). Try the newest code." };
  }
  await recordSecurityEvent("admin_login_success", { userId: state.userId, email: await currentEmail() });
  redirect(safeAdminRedirect(fd.get("next")));
}

export type MfaSetup = { ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string };

/** First admin sign-in: create an authenticator (shown as a QR code). */
export async function startAdminMfaSetup(): Promise<MfaSetup> {
  const state = await getMfaState();
  if (!state.userId || !state.staff) return { ok: false, error: "This account cannot use the admin dashboard." };
  if (state.factorId) return { ok: false, error: "An authenticator is already set up. Enter its code instead." };
  if (await limited(state.userId)) return { ok: false, error: "Too many attempts. Please wait 15 minutes and try again." };
  const supabase = await createSupabaseServerClient();
  // Remove half-finished set-ups (QR shown but never confirmed).
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "Abiye Admin",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}`,
  });
  if (error || !data) {
    console.error(`[admin-mfa] enroll failed: ${error?.code ?? error?.status ?? "unknown"}`);
    return { ok: false, error: "Could not start the set-up. Check that authenticator apps (TOTP) are enabled in Supabase → Authentication → Multi-Factor." };
  }
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmAdminMfaSetup(_prev: MfaFormState, fd: FormData): Promise<MfaFormState> {
  const state = await getMfaState();
  if (!state.userId) redirect("/admin/login");
  if (!state.staff) return { error: "This account cannot use the admin dashboard." };
  const factorId = z.guid().safeParse(fd.get("factorId"));
  const c = code.safeParse(fd.get("code"));
  if (!factorId.success) return { error: "Start the set-up again." };
  if (!c.success) return { error: "Enter the 6-digit code shown in your authenticator app." };
  if (await limited(state.userId)) return { error: "Too many attempts. Please wait 15 minutes and try again." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.data, code: c.data });
  if (error) {
    await recordSecurityEvent("admin_mfa_failed", { userId: state.userId, email: await currentEmail(), metadata: { setup: true } });
    return { error: "That code is not correct. Check the time on your phone is automatic, then try the newest code." };
  }
  await recordSecurityEvent("admin_login_success", { userId: state.userId, email: await currentEmail(), metadata: { first_setup: true } });
  redirect("/admin?mfaEnabled=1");
}
