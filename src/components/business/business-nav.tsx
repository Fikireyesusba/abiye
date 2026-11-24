"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, Store, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bottom tabs of the Abiye Business app (phone-first). */
export function BusinessNav({ waiting }: { waiting: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/business", label: "Orders", icon: Package, badge: waiting },
    { href: "/business/earnings", label: "Earnings", icon: Wallet },
    { href: "/business/shop", label: "My shop", icon: Store },
  ];
  return (
    <nav aria-label="Business" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-xl grid-cols-3">
        {tabs.map(({ href, label, icon: Icon, badge }) => {
          const active = href === "/business" ? path === "/business" : path.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined}
                className={cn("relative flex flex-col items-center gap-0.5 py-2 text-xs", active ? "text-primary" : "text-muted-foreground")}>
                <Icon className="size-5" aria-hidden />
                {label}
                {!!badge && <span className="absolute top-1 right-1/4 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 text-white" aria-label={`${badge} waiting`}>{badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
