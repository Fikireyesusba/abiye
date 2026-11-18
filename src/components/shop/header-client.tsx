"use client";
import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Languages, Menu, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { setLocale } from "@/i18n/actions";
import { useCartCount } from "@/lib/cart/store";
import { cn } from "@/lib/utils";

export function CartButton() {
  const count = useCartCount();
  const t = useTranslations("header");
  return (
    <Button variant="ghost" size="icon" asChild className="relative">
      <Link href="/cart" aria-label={t("cartLabel", { count })}>
        <ShoppingBag className="size-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-foreground tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, start] = useTransition();
  const next = locale === "en" ? "am" : "en";
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("gap-1.5", className)}
      disabled={pending}
      aria-label={`${t("language")}: ${next === "am" ? "አማርኛ" : "English"}`}
      onClick={() =>
        start(async () => {
          await setLocale(next);
          router.refresh();
        })
      }
    >
      <Languages className="size-4" />
      <span lang={next}>{next === "am" ? "አማርኛ" : "English"}</span>
    </Button>
  );
}

export interface NavLink {
  href: string;
  label: string;
}

export function DesktopNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              active && "text-foreground",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ links, title, secondary }: { links: NavLink[]; title: string; secondary: NavLink[] }) {
  const t = useTranslations("header");
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("openMenu")}>
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" closeLabel={t("closeMenu")}>
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col px-2" aria-label="Mobile">
          {links.map((l) => (
            <SheetClose asChild key={l.href}>
              <Link href={l.href} className="rounded-md px-3 py-3 text-base font-medium hover:bg-secondary">
                {l.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t p-2 pb-6">
          {secondary.map((l) => (
            <SheetClose asChild key={l.href}>
              <Link href={l.href} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary">
                {l.label}
              </Link>
            </SheetClose>
          ))}
          <LanguageSwitcher className="justify-start" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
