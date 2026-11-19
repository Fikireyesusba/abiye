import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Is the signed-in user an active staff member? Works before the second
 * login step. Falls back to my_admin_context on a database without
 * migration 0021 (where the admin context does not need the second step).
 */
export async function isStaffAccount(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_staff_status");
  if (!error) return !!(data as { staff?: boolean } | null)?.staff;
  const { data: ctx } = await supabase.rpc("my_admin_context");
  return !!ctx;
}

export interface MfaState {
  userId: string | null;
  staff: boolean;
  /** The session passed the second step (authenticator code). */
  verified: boolean;
  /** The verified authenticator to ask a code for, if one is set up. */
  factorId: string | null;
}

export async function getMfaState(): Promise<MfaState> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) return { userId: null, staff: false, verified: false, factorId: null };
  const [staff, factors] = await Promise.all([isStaffAccount(supabase), supabase.auth.mfa.listFactors()]);
  const factorId = factors.data?.totp.find((f) => f.status === "verified")?.id ?? null;
  return { userId, staff, verified: data?.claims?.aal === "aal2", factorId };
}
