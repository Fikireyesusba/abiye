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
  "audit.manage",
  "reviews.manage",
  "data.manage",
  "support.view",
  "support.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
/** Built-in sets are super_admin, manager, staff; a Super Admin can create more (Staff → Permission sets). */
export type RoleKey = string;

export interface AdminContext {
  userId: string;
  fullName: string;
  role: RoleKey;
  /** Display name of the person's permission set (e.g. "Manager", "Cashier"). */
  roleName: string;
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
  if (typeof r.user_id !== "string" || typeof r.role !== "string" || !/^[a-z_]{2,40}$/.test(r.role)) return null;
  const perms = Array.isArray(r.permissions) ? r.permissions.filter(isPermission) : [];
  return {
    userId: r.user_id,
    fullName: typeof r.full_name === "string" ? r.full_name : "",
    role: r.role,
    roleName: typeof r.role_name === "string" && r.role_name ? r.role_name : r.role.replaceAll("_", " "),
    permissions: new Set(perms),
  };
}

/** Admin navigation and the permission each entry needs (used by sidebar + guards). */
export const ADMIN_ROUTES: ReadonlyArray<{ href: string; label: string; anyOf: readonly Permission[] }> = [
  { href: "/admin", label: "Dashboard", anyOf: ["dashboard.view"] },
  { href: "/admin/orders", label: "Orders", anyOf: ["orders.view_all", "orders.view_assigned"] },
  { href: "/admin/payments", label: "Payments", anyOf: ["payments.view"] },
  { href: "/admin/in-store", label: "In-store sales", anyOf: ["orders.manage"] },
  { href: "/admin/wallet", label: "Wallet", anyOf: ["wallet.manage"] },
  { href: "/admin/printing", label: "Printing", anyOf: ["printing.view"] },
  { href: "/admin/products", label: "Products", anyOf: ["products.view"] },
  { href: "/admin/categories", label: "Categories", anyOf: ["categories.manage"] },
  { href: "/admin/inventory", label: "Inventory", anyOf: ["inventory.manage"] },
  { href: "/admin/customers", label: "Customers", anyOf: ["customers.view"] },
  { href: "/admin/support", label: "Support tickets", anyOf: ["support.view"] },
  { href: "/admin/follow-up", label: "Stalled checkouts", anyOf: ["customers.view"] },
  { href: "/admin/promotions", label: "Promotions", anyOf: ["promotions.manage"] },
  { href: "/admin/reviews", label: "Reviews", anyOf: ["reviews.manage"] },
  { href: "/admin/analytics", label: "Analytics", anyOf: ["analytics.view", "reports.operational"] },
  { href: "/admin/reports", label: "Sales reports", anyOf: ["analytics.view"] },
  { href: "/admin/staff", label: "Staff", anyOf: ["staff.manage"] },
  { href: "/admin/notifications", label: "Notifications", anyOf: ["settings.manage"] },
  { href: "/admin/services", label: "Manage services", anyOf: ["settings.manage"] },
  { href: "/admin/settings", label: "Settings", anyOf: ["settings.manage", "bank_accounts.manage"] },
  { href: "/admin/activity", label: "Activity log", anyOf: ["audit.view"] },
  { href: "/admin/security", label: "Security", anyOf: ["audit.view"] },
  { href: "/admin/users", label: "Signed-in users", anyOf: ["security.manage", "customers.view"] },
  { href: "/admin/exports", label: "Excel exports", anyOf: ["orders.view_all", "payments.view", "customers.view", "products.view", "wallet.manage", "printing.view", "support.view", "audit.view", "settings.manage", "security.manage", "data.manage"] },
  { href: "/admin/data", label: "Export & reset", anyOf: ["data.manage"] },
];
