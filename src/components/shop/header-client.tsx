"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CircleHelp, Info, Languages, Mail, PackageSearch, ShoppingBag, UserRound, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const MENU_ICONS: Record<string, typeof UserRound> = { "/account": UserRound, "/track-order": PackageSearch, "/support": LifeBuoy, "/about": Info, "/contact": Mail, "/help": CircleHelp };

/** Profile icon (top right): My account, Track order, About, Contact and the language switch. */
export function AccountMenu({ links }: { links: NavLink[] }) {
  const t = useTranslations("account");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="icon" aria-label={t("accountLink")} aria-haspopup="true" aria-expanded={open} aria-controls="account-menu"
        onClick={() => setOpen((v) => !v)}>
        <UserRound className="size-5" />
      </Button>
      {open && (
        <div id="account-menu" className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border bg-card p-1.5 shadow-lg">
          <nav aria-label={t("accountLink")} className="flex flex-col">
            {links.map((l, i) => {
              const Icon = MENU_ICONS[l.href] ?? UserRound;
              return (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
                  className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-secondary", i === 0 && "font-medium")}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden /> {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-1 border-t pt-1">
            <LanguageSwitcher className="w-full justify-start px-3 font-normal" />
          </div>
        </div>
      )}
    </div>
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

export function MainNav({ links }: { links: (NavLink & { always?: boolean })[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-3",
              active && "text-foreground",
              !l.always && "hidden lg:inline-flex",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
