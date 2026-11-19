"use server";
import { isStaffAccount } from "@/lib/auth/mfa";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/tokens";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ethiopianPhoneSchema } from "@/lib/validation/checkout";
import { getCustomerUser, safeNext } from "./session";

/** Error codes are translation keys under "account.errors". */
export type AccountState = { error?: string; ok?: string; email?: string; name?: string };

const email = z.email().max(254);
const password = z.string().min(8).max(72).regex(/[A-Za-z]/).regex(/\d/);

export async function signUpCustomer(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const values = {
    name: String(fd.get("fullName") ?? "").trim().slice(0, 120),
    email: String(fd.get("email") ?? "").trim().toLowerCase().slice(0, 254),
  };
  if (values.name.length < 2) return { ...values, error: "name" };
  if (!email.safeParse(values.email).success) return { ...values, error: "email" };
  if (!password.safeParse(fd.get("password")).success) return { ...values, error: "weakPassword" };
  if (fd.get("password") !== fd.get("confirm")) return { ...values, error: "passwordMismatch" };
  if (fd.get("acceptTerms") !== "on") return { ...values, error: "terms" };

  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`signup:ip:${ip}`, 5, 3600]]))) return { ...values, error: "rateLimited" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: values.email,
    password: String(fd.get("password")),
    options: {
      data: { full_name: values.name, accepted_terms: "true" },
      emailRedirectTo: `${getServerEnv().APP_URL}/account`,
    },
  });
  if (error && !/already|registered/i.test(error.message)) {
    if (/password/i.test(error.message)) return { ...values, error: "weakPassword" };
    console.error("[account] sign-up failed:", error.code ?? error.status);
    return { ...values, error: "generic" };
  }
  // Same answer whether or not the email already exists (no account enumeration).
  return { ok: "checkEmail", email: values.email };
}

export async function signInCustomer(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const addr = String(fd.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const pw = String(fd.get("password") ?? "");
  if (!email.safeParse(addr).success || !pw) return { email: addr, error: "invalidLogin" };
  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`login:ip:${ip}`, 20, 900], [`login:email:${sha256Hex(addr).slice(0, 32)}`, 5, 900]]))) {
    return { email: addr, error: "rateLimited" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email: addr, password: pw });
  if (!error && signedIn.user) {
    // Belt and braces: the Supabase ban normally refuses the sign-in already.
    const { data: account } = await supabase.from("customer_accounts").select("deactivated_at").eq("id", signedIn.user.id).maybeSingle();
    if (account?.deactivated_at) {
      await supabase.auth.signOut({ scope: "local" });
      return { email: addr, error: "deactivated" };
    }
  }
  if (error) {
    console.warn(`[customer-login] failed: ${error.code ?? "unknown"} (status ${error.status ?? "?"})`);
    if (error.code === "user_banned") return { email: addr, error: "deactivated" };
    return { email: addr, error: /not confirmed/i.test(error.message) ? "notConfirmed" : "invalidLogin" };
  }
  redirect(safeNext(fd.get("next")));
}

export async function resendConfirmation(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const addr = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email.safeParse(addr).success) return { error: "email" };
  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`resend:ip:${ip}`, 5, 3600], [`resend:email:${sha256Hex(addr).slice(0, 32)}`, 3, 3600]]))) {
    return { email: addr, error: "rateLimited" };
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resend({ type: "signup", email: addr });
  return { ok: "checkEmail", email: addr };
}

export async function requestPasswordReset(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const addr = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email.safeParse(addr).success) return { error: "email" };
  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`reset:ip:${ip}`, 5, 3600], [`reset:email:${sha256Hex(addr).slice(0, 32)}`, 3, 3600]]))) {
    return { email: addr, error: "rateLimited" };
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(addr);
  return { ok: "resetSent", email: addr }; // same answer for unknown emails
}

/** After following the reset link (/auth/confirm signs the user in for this). */
export async function setNewPassword(_prev: AccountState, fd: FormData): Promise<AccountState> {
  if (!password.safeParse(fd.get("password")).success) return { error: "weakPassword" };
  if (fd.get("password") !== fd.get("confirm")) return { error: "passwordMismatch" };
  const user = await getCustomerUser();
  if (!user) return { error: "linkExpired" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: String(fd.get("password")) });
  if (error) {
    if (error.code === "same_password" || /different from the old/i.test(error.message)) return { error: "samePassword" };
    return { error: /reauthentic|recent/i.test(error.message) ? "linkExpired" : "generic" };
  }
  // Staff (same login system) go straight back to the admin dashboard.
  redirect((await isStaffAccount(supabase)) ? "/admin?passwordChanged=1" : "/account?passwordChanged=1");
}

export async function updateCustomerAccount(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const user = await getCustomerUser();
  if (!user) redirect("/account/login?next=/account");
  const name = String(fd.get("fullName") ?? "").trim();
  if (name.length < 2 || name.length > 120) return { error: "name" };
  const rawPhone = String(fd.get("phone") ?? "").trim();
  const phone = rawPhone ? ethiopianPhoneSchema.safeParse(rawPhone) : null;
  if (phone && !phone.success) return { error: "phone" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("customer_accounts")
    .update({ full_name: name, phone: phone?.success ? phone.data : null })
    .eq("id", user.id);
  return error ? { error: "generic" } : { ok: "saved" };
}

/** "This order belongs to another account": sign out, then sign in again and return to the page. */
export async function switchCustomerAccount(fd: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(`/account/login?next=${encodeURIComponent(safeNext(fd.get("next")))}`);
}

export async function signOutCustomer(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
