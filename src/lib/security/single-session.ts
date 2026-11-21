import "server-only";
import { cookies } from "next/headers";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { PUSH_CLAIM_COOKIE } from "./session-cookies";

/**
 * One device/browser per account: a completed sign-in ends every OTHER session
 * of the account (Supabase deletes them). The database then refuses the old
 * tokens (private.session_alive) and the proxy sends that browser to the login
 * page with "signed in on another device".
 */
export async function endOtherSessions(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, opts: { customer?: boolean } = {}) {
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) console.warn(`[session] could not end other sessions: ${error.code ?? error.status ?? "unknown"}`);
  // Customers: this device's phone notifications move to the account that just signed in (PushClaim).
  if (opts.customer) {
    (await cookies()).set(PUSH_CLAIM_COOKIE, "1", { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600 });
  }
}
