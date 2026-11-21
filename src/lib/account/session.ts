import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isStaffAccount } from "@/lib/auth/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CustomerUser {
  id: string;
  email: string;
}

/** The signed-in customer (JWT verified by Supabase), or null. Deduplicated per request. */
export const getCustomerUser = cache(async (): Promise<CustomerUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string") return null;
  // A deactivated account keeps a valid JWT until it expires (the Supabase ban
  // only stops new sign-ins/refreshes), so check the account on every request.
  const { data: account } = await supabase.from("customer_accounts").select("deactivated_at").eq("id", sub).maybeSingle();
  if (account?.deactivated_at) return null;
  // A staff session (signed in to the dashboard) is not a customer session.
  if (await isStaffAccount(supabase)) return null;
  const emailClaim = data?.claims?.email;
  return { id: sub, email: typeof emailClaim === "string" ? emailClaim : "" };
});

/** Any signed-in account (customer OR staff) — only for password reset, which serves both. */
export async function getSignedInUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return error || typeof sub !== "string" ? null : sub;
}

export async function requireCustomer(next: string): Promise<CustomerUser> {
  const user = await getCustomerUser();
  if (!user) redirect(`/account/login?next=${encodeURIComponent(safeNext(next))}`);
  return user;
}

/** Same-site, non-admin destinations only (no //host, no schemes). */
export function safeNext(next: unknown, fallback = "/account"): string {
  if (typeof next !== "string") return fallback;
  if (!/^\/(?!\/|\\)[A-Za-z0-9/_\-?=&.%]*$/.test(next) || next.startsWith("/admin") || next.includes("..")) return fallback;
  return next;
}

export async function getCustomerAccount(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("customer_accounts").select("full_name, phone, accepted_terms_at, wallet_balance_etb, default_zone_id, default_address, date_of_birth, sex").eq("id", userId).maybeSingle();
  return data;
}
