import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAdminContext, type AdminContext, type Permission } from "./permissions";

/**
 * Resolve the signed-in administrator for this request (deduplicated per
 * render with React cache). The JWT is verified by Supabase (getClaims), and
 * role/permissions come from the database — never from client input.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims?.sub) return null;
  // Two-step login: admin access only after the authenticator code (also enforced in the database).
  if (claims.claims.aal !== "aal2") return null;
  const { data, error: rpcError } = await supabase.rpc("my_admin_context");
  if (rpcError) return null;
  return parseAdminContext(data);
});

/** Use at the top of every admin page / server action / route handler. */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) {
    // Signed in with the password only: ask for the authenticator code.
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    redirect(data?.claims?.sub ? "/admin/mfa" : "/admin/login");
  }
  return ctx;
}

export async function requirePermission(...anyOf: Permission[]): Promise<AdminContext> {
  const ctx = await requireAdmin();
  // 404 rather than 403: do not reveal admin features a role cannot use.
  if (!anyOf.some((p) => ctx.permissions.has(p))) notFound();
  return ctx;
}
