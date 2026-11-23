/** Only same-site admin paths; blocks //evil.com, /\evil.com, schemes and encoded tricks. */
export function safeAdminRedirect(next: unknown): string {
  if (typeof next !== "string") return "/admin";
  // Two-step login before choosing a new password (staff password reset).
  if (next === "/account/reset-password") return next;
  // The courier app is a staff area too.
  if (/^\/courier(\/[A-Za-z0-9/_-]*)?$/.test(next)) return next;
  if (!/^\/admin(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_%.-]*)?$/.test(next)) return "/admin";
  if (next.startsWith("/admin/login") || next.startsWith("/admin/mfa")) return "/admin";
  return next;
}
