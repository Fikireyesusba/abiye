import type { Metadata } from "next";
import Link from "next/link";
import { LogOut, Search, UserCircle } from "lucide-react";
import { AdminMobileNav, AdminSidebar, type NavItem } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { signOut } from "@/lib/auth/actions";
import { requireAdmin } from "@/lib/auth/guards";
import { ADMIN_ROUTES } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Abiye Admin" },
  robots: { index: false, follow: false },
};

const ROLE_LABEL = { super_admin: "Super Admin", manager: "Manager", staff: "Staff" } as const;

/**
 * Admin shell. NOTE: this is presentation only — layouts do not re-run on
 * client navigation, so every page and server action performs its own
 * requirePermission() check, and RLS applies to every query.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const pending = ctx.permissions.has("payments.view")
    ? (await supabase.from("payment_submissions").select("id", { count: "exact", head: true }).eq("status", "pending")).count ?? 0
    : 0;

  const items: NavItem[] = ADMIN_ROUTES.filter((r) => r.anyOf.some((p) => ctx.permissions.has(p))).map((r) => ({
    href: r.href,
    label: r.label,
    badge: r.href === "/admin/payments" ? pending : undefined,
  }));
  const canSearch = ctx.permissions.has("orders.view_all") || ctx.permissions.has("orders.view_assigned");

  return (
    <div className="flex min-h-screen bg-muted/30">
      <AdminSidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <AdminMobileNav items={items} />
          {canSearch && (
            <form action="/admin/orders" method="get" role="search" className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <label htmlFor="admin-search" className="sr-only">Search orders</label>
              <input id="admin-search" name="q" type="search" maxLength={40} placeholder="Order number or phone…"
                className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
            </form>
          )}
          <div className="ml-auto flex items-center gap-2">
            {pending > 0 && (
              <Link href="/admin/payments" className="hidden rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground sm:inline">
                {pending} payment{pending === 1 ? "" : "s"} to verify
              </Link>
            )}
            <Link href="/admin/account" className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-secondary">
              <UserCircle className="size-5 text-muted-foreground" aria-hidden />
              <span className="hidden text-right leading-tight sm:block">
                <span className="block font-medium">{ctx.fullName}</span>
                <span className="block text-xs text-muted-foreground">{ROLE_LABEL[ctx.role]}</span>
              </span>
            </Link>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
