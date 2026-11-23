import "server-only";
import { telegramSoon } from "@/lib/telegram/dispatch";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { roleAllowedOn, surfaceForHost } from "@/lib/security/hosts";
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
  const ctx = parseAdminContext(data);
  // Each permission set signs in at its own address (staff / Super Admin / courier) when the split is on.
  if (ctx && !roleAllowedOn(await currentSurface(), ctx.role)) return null;
  return ctx;
});

/** Which part of the website this request's address serves (null = no split configured). */
export async function currentSurface() {
  return surfaceForHost((await headers()).get("host"));
}

/** Signed in as staff, but at another role's address: refused (not signed out — that account is fine elsewhere). */
async function wrongAddress(): Promise<boolean> {
  const surface = await currentSurface();
  if (surface === null) return false;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("my_staff_status");
  const role = (data as { role?: string | null } | null)?.role;
  return !!role && !roleAllowedOn(surface, role);
}

/** Use at the top of every admin page / server action / route handler. */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) {
    if (await wrongAddress()) redirect("/admin/login?reason=address");
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
  // Admin actions can queue Telegram activity messages: send them after the response.
  telegramSoon();
  return ctx;
}
