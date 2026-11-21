import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "@/lib/account/session";
import { endOtherSessions } from "@/lib/security/single-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["email", "signup", "recovery", "invite", "email_change"];
// Invited users have no password yet; like a reset, they choose one first.
const SET_PASSWORD: EmailOtpType[] = ["recovery", "invite"];

/**
 * Email links (confirm sign-up, reset password, invitation) land here. token_hash links
 * work on any device; the session cookie is set by verifyOtp.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));
  const fail = NextResponse.redirect(new URL("/account/login?error=link", request.url));

  if (!tokenHash || !type || !TYPES.includes(type) || !/^[A-Za-z0-9_-]{8,200}$/.test(tokenHash)) return fail;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail;
  await endOtherSessions(supabase, { customer: true });
  if (SET_PASSWORD.includes(type)) return NextResponse.redirect(new URL("/account/reset-password", request.url));
  return NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}welcome=1`, request.url));
}
