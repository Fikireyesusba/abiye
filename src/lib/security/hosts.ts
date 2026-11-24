/**
 * One website, separate addresses (set in Vercel; the first four must be set to switch the split on):
 *   CUSTOMER_HOST     abiye.site             customers: shop and customer app only
 *   STAFF_HOST        ocs.abiye.site         managers / staff (and other permission sets): admin portal
 *   SUPER_ADMIN_HOST  operations.abiye.site  Super Admins only: admin portal
 *   COURIER_HOST      courier.abiye.site     couriers only: their deliveries
 *   BUSINESS_HOST     business.abiye.site    partner shops only: Abiye Business app (optional — until it is set,
 *                                            partner shop staff use the courier address)
 * Not set (local development, before DNS is ready) → no split: everything works on every address.
 * When set, any other address (e.g. a *.vercel.app link) is treated like the customer address (no admin).
 * Used by the proxy (no server-only imports here) and by the server guards.
 */
export type Surface = "customer" | "staff" | "super" | "courier" | "business";

const clean = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "") || null;

export function surfaceHosts(): Record<Surface, string | null> | null {
  const h = {
    customer: clean(process.env.CUSTOMER_HOST),
    staff: clean(process.env.STAFF_HOST),
    super: clean(process.env.SUPER_ADMIN_HOST),
    courier: clean(process.env.COURIER_HOST),
    business: clean(process.env.BUSINESS_HOST),
  };
  return h.customer && h.staff && h.super && h.courier ? h : null;
}

/** Partner shops have their own address (otherwise they share the courier address). */
const businessHostSet = () => !!surfaceHosts()?.business;

/** Which part of the website this address serves; null = no split configured (everything allowed). */
export function surfaceForHost(host: string | null | undefined): Surface | null {
  const hosts = surfaceHosts();
  if (!hosts) return null;
  const h = clean(host ?? "");
  const found = (Object.keys(hosts) as Surface[]).find((s) => hosts[s] && hosts[s] === h);
  return found ?? "customer";
}

/** May a staff member with this permission set use the admin / courier / business part on this address? */
export function roleAllowedOn(surface: Surface | null, role: string): boolean {
  if (surface === null) return true;
  if (surface === "super") return role === "super_admin";
  if (surface === "courier") return role === "courier" || (role === "partner" && !businessHostSet());
  if (surface === "business") return role === "partner";
  if (surface === "staff") return role !== "super_admin" && role !== "courier" && role !== "partner";
  return false; // customer address: no staff sign-in at all
}

/** The address a person with this permission set signs in at (for messages and links). */
export function homeSurfaceForRole(role: string): Surface {
  if (role === "partner") return businessHostSet() ? "business" : "courier";
  return role === "super_admin" ? "super" : role === "courier" ? "courier" : "staff";
}

/** Name of the installed app on this address (home screen). */
export function appNameForSurface(surface: Surface | null, business = "Abiye"): string {
  return surface === "courier" ? `${business} Courier` : surface === "business" ? `${business} Business` : surface === "super" ? `${business} Operations` : surface === "staff" ? `${business} OCS` : business;
}

/** https://<address> of a part of the website, or null when the split (or that address) is not configured. */
export function surfaceUrl(surface: Surface): string | null {
  const host = surfaceHosts()?.[surface];
  return host ? `https://${host}` : null;
}

/** First page of an address that is not the shop. */
export function homePathForSurface(surface: Surface): string {
  return surface === "courier" ? "/courier" : surface === "business" ? "/business" : "/admin";
}

/** Paths each address may open (pages only; API routes and static files are not affected). */
export function pathAllowed(surface: Surface, path: string): boolean {
  if (path === "/offline") return true; // the installed app's offline page, on every address
  const admin = /^\/admin(\/|$)/.test(path);
  const courier = /^\/courier(\/|$)/.test(path);
  const business = /^\/business(\/|$)/.test(path);
  const signIn = /^\/admin\/(login|mfa|password)(\/|$)/.test(path);
  switch (surface) {
    case "customer": return !admin && !courier && !business;
    case "staff":
    case "super": return admin;
    case "courier": return courier || signIn || (business && !businessHostSet());
    case "business": return business || signIn;
  }
}
