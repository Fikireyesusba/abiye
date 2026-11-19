"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bell, Boxes, Clock, History, Megaphone, CreditCard, FolderTree, LayoutDashboard, Menu, Package, Printer, Settings, ShoppingCart, UserCog, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountBadge, badgeTotal, useAdminBadges } from "./admin-badges";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/admin": LayoutDashboard,
  "/admin/orders": ShoppingCart,
  "/admin/payments": CreditCard,
  "/admin/printing": Printer,
  "/admin/products": Package,
  "/admin/categories": FolderTree,
  "/admin/inventory": Boxes,
  "/admin/customers": Users,
  "/admin/staff": UserCog,
  "/admin/notifications": Bell,
  "/admin/settings": Settings,
  "/admin/follow-up": Clock,
  "/admin/promotions": Megaphone,
  "/admin/analytics": BarChart3,
  "/admin/activity": History,
};

export interface NavItem {
  href: string;
  label: string;
}

const BADGE_LABEL: Record<string, string> = {
  "/admin/payments": "payments waiting for verification",
  "/admin/orders": "paid orders waiting to be processed",
  "/admin/printing": "printing jobs waiting for a quote or printing",
  "/admin/notifications": "failed Telegram notifications",
};

function Links({ items, onNavigate }: { items: NavItem[]; onNavigate?: boolean }) {
  const pathname = usePathname();
  const badges = useAdminBadges();
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        const link = (
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-sidebar-accent font-medium text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            <CountBadge count={badges[item.href as keyof typeof badges] ?? 0} label={`${badges[item.href as keyof typeof badges]} ${BADGE_LABEL[item.href] ?? "waiting"}`} />
          </Link>
        );
        return <li key={item.href}>{onNavigate ? <SheetClose asChild>{link}</SheetClose> : link}</li>;
      })}
    </ul>
  );
}

export function AdminSidebar({ items }: { items: NavItem[] }) {
  return (
    <aside className="hidden w-60 shrink-0 bg-sidebar text-sidebar-foreground lg:block">
      <div className="sticky top-0 flex h-screen flex-col">
        <Link href="/admin" className="flex h-16 items-center gap-2 px-5 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">A</span>
          Abiye Admin
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Admin">
          <Links items={items} />
        </nav>
      </div>
    </aside>
  );
}

export function AdminMobileNav({ items }: { items: NavItem[] }) {
  const total = badgeTotal(useAdminBadges());
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative lg:hidden" aria-label={total ? `Open admin menu (${total} waiting for action)` : "Open admin menu"}>
          <Menu className="size-5" />
          <CountBadge count={total} label={`${total} waiting for action`} className="absolute -top-1 -right-1 min-w-4 px-1 text-[10px] leading-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="bg-sidebar text-sidebar-foreground" closeLabel="Close menu">
        <SheetHeader>
          <SheetTitle className="text-white">Abiye Admin</SheetTitle>
        </SheetHeader>
        <nav className="px-3" aria-label="Admin mobile">
          <Links items={items} onNavigate />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
