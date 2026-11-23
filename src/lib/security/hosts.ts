/**
 * One website, four addresses (set in Vercel; all four must be set to switch the split on):
 *   CUSTOMER_HOST     fantaf.xyz             customers: shop and customer app only
 *   STAFF_HOST        ocs.fantaf.xyz         managers / staff (and other permission sets): admin portal
 *   SUPER_ADMIN_HOST  operations.fantaf.xyz  Super Admins only: admin portal
 *   COURIER_HOST      courier.fantaf.xyz     couriers only: their deliveries
 * Not set (local development, before DNS is ready) → no split: everything works on every address.
 * When set, any other address (e.g. a *.vercel.app link) is treated like the customer address (no admin).
 * Used by the proxy (no server-only imports here) and by the server guards.
 */
export type Surface = "customer" | "staff" | "super" | "courier";

const clean = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "") || null;

export function surfaceHosts(): Record<Surface, string> | null {
  const h = {
    customer: clean(process.env.CUSTOMER_HOST),
    staff: clean(process.env.STAFF_HOST),
    super: clean(process.env.SUPER_ADMIN_HOST),
    courier: clean(process.env.COURIER_HOST),
  };
  return h.customer && h.staff && h.super && h.courier ? (h as Record<Surface, string>) : null;
}

/** Which part of the website this address serves; null = no split configured (everything allowed). */
export function surfaceForHost(host: string | null | undefined): Surface | null {
  const hosts = surfaceHosts();
  if (!hosts) return null;
  const h = clean(host ?? "");
  const found = (Object.keys(hosts) as Surface[]).find((s) => hosts[s] === h);
  return found ?? "customer";
}

/** May a staff member with this permission set use the admin / courier part on this address? */
export function roleAllowedOn(surface: Surface | null, role: string): boolean {
  if (surface === null) return true;
  if (surface === "super") return role === "super_admin";
  if (surface === "courier") return role === "courier";
  if (surface === "staff") return role !== "super_admin" && role !== "courier";
  return false; // customer address: no staff sign-in at all
}

/** The address a person with this permission set signs in at (for messages and links). */
export function homeSurfaceForRole(role: string): Surface {
  return role === "super_admin" ? "super" : role === "courier" ? "courier" : "staff";
}

/** https://<address> of a part of the website, or null when the split is not configured. */
export function surfaceUrl(surface: Surface): string | null {
  const hosts = surfaceHosts();
  return hosts ? `https://${hosts[surface]}` : null;
}

/** Paths each address may open (pages only; API routes and static files are not affected). */
export function pathAllowed(surface: Surface, path: string): boolean {
  const admin = /^\/admin(\/|$)/.test(path);
  const courier = /^\/courier(\/|$)/.test(path);
  const signIn = /^\/admin\/(login|mfa|password)(\/|$)/.test(path);
  switch (surface) {
    case "customer": return !admin && !courier;
    case "staff":
    case "super": return admin;
    case "courier": return courier || signIn;
  }
}
