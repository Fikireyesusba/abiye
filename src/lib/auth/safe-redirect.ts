/** Only same-site admin paths; blocks //evil.com, /\evil.com, schemes and encoded tricks. */
export function safeAdminRedirect(next: unknown): string {
  if (typeof next !== "string") return "/admin";
  if (!/^\/admin(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_%.-]*)?$/.test(next)) return "/admin";
  if (next.startsWith("/admin/login") || next.startsWith("/admin/mfa")) return "/admin";
  return next;
}
