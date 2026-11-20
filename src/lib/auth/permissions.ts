/**
 * Permission keys — must match public.admin_permissions (migration 0002).
 * The database is the source of truth for which role holds which permission;
 * this list exists for type safety and navigation rendering.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "products.view",
  "products.manage",
  "categories.manage",
  "inventory.manage",
  "orders.view_all",
  "orders.view_assigned",
  "orders.manage",
  "orders.update_fulfillment",
  "payments.view",
  "payments.verify",
  "printing.view",
  "printing.manage",
  "printing.pricing",
  "customers.view",
  "customers.manage",
  "wallet.manage",
  "wallet.adjust",
  "security.manage",
  "reports.operational",
  "analytics.view",
  "promotions.manage",
  "staff.manage",
  "settings.manage",
  "bank_accounts.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type RoleKey = "super_admin" | "manager" | "staff";

export interface AdminContext {
  userId: string;
  fullName: string;
  role: RoleKey;
  permissions: ReadonlySet<Permission>;
}

export function hasPermission(ctx: AdminContext | null, permission: Permission): boolean {
  return !!ctx && ctx.permissions.has(permission);
}

export function hasAnyPermission(ctx: AdminContext | null, permissions: readonly Permission[]): boolean {
  return !!ctx && permissions.some((p) => ctx.permissions.has(p));
}

const isPermission = (p: unknown): p is Permission =>
  typeof p === "string" && (PERMISSIONS as readonly string[]).includes(p);

/** Parse the jsonb returned by public.my_admin_context(). Unknown keys are dropped. */
export function parseAdminContext(raw: unknown): AdminContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.user_id !== "string" || typeof r.role !== "string") return null;
  if (!["super_admin", "manager", "staff"].includes(r.role)) return null;
  const perms = Array.isArray(r.permissions) ? r.permissions.filter(isPermission) : [];
  return {
    userId: r.user_id,
    fullName: typeof r.full_name === "string" ? r.full_name : "",
    role: r.role as RoleKey,
    permissions: new Set(perms),
  };
}

/** Admin navigation and the permission each entry needs (used by sidebar + guards). */
export const ADMIN_ROUTES: ReadonlyArray<{ href: string; label: string; anyOf: readonly Permission[] }> = [
  { href: "/admin", label: "Dashboard", anyOf: ["dashboard.view"] },
  { href: "/admin/orders", label: "Orders", anyOf: ["orders.view_all", "orders.view_assigned"] },
  { href: "/admin/payments", label: "Payments", anyOf: ["payments.view"] },
  { href: "/admin/wallet", label: "Wallet", anyOf: ["wallet.manage"] },
  { href: "/admin/printing", label: "Printing", anyOf: ["printing.view"] },
  { href: "/admin/products", label: "Products", anyOf: ["products.view"] },
  { href: "/admin/categories", label: "Categories", anyOf: ["categories.manage"] },
  { href: "/admin/inventory", label: "Inventory", anyOf: ["inventory.manage"] },
  { href: "/admin/customers", label: "Customers", anyOf: ["customers.view"] },
  { href: "/admin/follow-up", label: "Stalled checkouts", anyOf: ["customers.view"] },
  { href: "/admin/promotions", label: "Promotions", anyOf: ["promotions.manage"] },
  { href: "/admin/analytics", label: "Analytics", anyOf: ["analytics.view", "reports.operational"] },
  { href: "/admin/staff", label: "Staff", anyOf: ["staff.manage"] },
  { href: "/admin/notifications", label: "Notifications", anyOf: ["settings.manage"] },
  { href: "/admin/settings", label: "Settings", anyOf: ["settings.manage", "bank_accounts.manage"] },
  { href: "/admin/activity", label: "Activity log", anyOf: ["audit.view"] },
  { href: "/admin/security", label: "Security", anyOf: ["audit.view"] },
];
