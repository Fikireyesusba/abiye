import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["email", "signup", "recovery", "email_change"];

/**
 * Email links (confirm sign-up, reset password) land here. token_hash links
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
  const dest = type === "recovery" ? "/account/reset-password" : next;
  return NextResponse.redirect(new URL(type === "recovery" ? dest : `${dest}${dest.includes("?") ? "&" : "?"}welcome=1`, request.url));
}
