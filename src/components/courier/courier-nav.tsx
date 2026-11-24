"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Truck, UserRound, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bottom tabs of the courier app (phone-first). */
export function CourierNav({ unread }: { unread: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/courier", label: "Deliveries", icon: Truck },
    { href: "/courier/earnings", label: "Earnings", icon: Wallet },
    { href: "/courier/notifications", label: "Notifications", icon: Bell, badge: unread },
    { href: "/courier/profile", label: "Profile", icon: UserRound },
  ];
  return (
    <nav aria-label="Courier" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {tabs.map(({ href, label, icon: Icon, badge }) => {
          const active = href === "/courier" ? path === "/courier" : path.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined}
                className={cn("relative flex flex-col items-center gap-0.5 py-2 text-xs", active ? "text-primary" : "text-muted-foreground")}>
                <Icon className="size-5" aria-hidden />
                {label}
                {!!badge && <span className="absolute top-1 right-1/4 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 text-white" aria-label={`${badge} unread`}>{badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
