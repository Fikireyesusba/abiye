"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/tokens";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAdminContext } from "./permissions";
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
  if (!allowed) return { error: "Too many sign-in attempts. Please wait 15 minutes and try again.", email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: GENERIC, email };

  // Valid Supabase user but not an active staff member: sign straight back out.
  const { data } = await supabase.rpc("my_admin_context");
  if (!parseAdminContext(data)) {
    await supabase.auth.signOut();
    return { error: "This account does not have access to the admin dashboard.", email };
  }
  redirect(safeAdminRedirect(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
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
