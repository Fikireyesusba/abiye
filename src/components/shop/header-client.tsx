"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, CircleHelp, Headset, History, Info, Mail, Megaphone, PackageSearch, Printer, ShoppingBag, UserRound, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export interface DrawerViewer { name: string; email: string; memberId: string | null }

/**
 * Profile icon (top right) → full-height side menu: a header with the customer's name and "View profile",
 * one row per section, and a printing card at the bottom. Signed-out visitors get Sign in / Create account.
 */
export function AccountMenu({ viewer, printingOn }: { viewer: DrawerViewer | null; printingOn: boolean }) {
  const t = useTranslations("drawer");
  const ta = useTranslations("account");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) { setSeen(pathname); setOpen(false); } // close after navigating
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  const rows = viewer
    ? [
        { href: "/account/wallet", label: t("balance"), icon: Wallet },
        { href: "/account/orders", label: t("orders"), icon: History },
        { href: "/track-order", label: t("track"), icon: PackageSearch },
        { href: "/account/offers", label: t("offers"), icon: Megaphone },
        { href: "/account/notifications", label: t("notifications"), icon: Bell },
        { href: "/support", label: t("support"), icon: Headset },
        { href: "/help", label: t("help"), icon: CircleHelp },
        { href: "/about", label: t("about"), icon: Info },
        { href: "/contact", label: t("contact"), icon: Mail },
      ]
    : [
        { href: "/track-order", label: t("track"), icon: PackageSearch },
        { href: "/support", label: t("support"), icon: Headset },
        { href: "/help", label: t("help"), icon: CircleHelp },
        { href: "/about", label: t("about"), icon: Info },
        { href: "/contact", label: t("contact"), icon: Mail },
      ];
  const initials = (viewer?.name || viewer?.email || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={ta("accountLink")} aria-haspopup="dialog" aria-expanded={open} aria-controls="account-menu"
        onClick={() => setOpen(true)}>
        <UserRound className="size-5" />
      </Button>
      {open && createPortal(
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={ta("accountLink")}>
          <button type="button" className="absolute inset-0 bg-black/40 animate-in fade-in" aria-label={t("close")} onClick={() => setOpen(false)} />
          <div ref={panel} id="account-menu" className="absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col overflow-y-auto rounded-r-2xl bg-background shadow-2xl animate-in slide-in-from-left">
            <div className="relative bg-gradient-to-br from-primary to-primary/80 px-5 pt-8 pb-6 text-primary-foreground">
              <button type="button" onClick={() => setOpen(false)} className="absolute top-3 right-3 rounded-full p-1.5 hover:bg-white/15" aria-label={t("close")}>
                <X className="size-5" aria-hidden />
              </button>
              <div className="flex items-center gap-4">
                <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-4 border-white/80 bg-white/90 text-xl font-semibold text-primary" aria-hidden>
                  {viewer ? initials : <UserRound className="size-8" />}
                </span>
                {viewer ? (
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{viewer.name || viewer.email}</p>
                    <Link href="/account/profile" onClick={() => setOpen(false)} className="text-sm opacity-90 hover:underline" data-testid="view-profile">{t("viewProfile")}</Link>
                  </div>
                ) : (
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm opacity-90">{t("signInPrompt")}</p>
                    <div className="flex gap-2">
                      <Link href="/account/login" onClick={() => setOpen(false)} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-primary">{ta("signIn")}</Link>
                      <Link href="/account/signup" onClick={() => setOpen(false)} className="rounded-md border border-white/70 px-3 py-1.5 text-sm font-medium">{ta("signUp")}</Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <nav aria-label={ta("accountLink")} className="flex flex-col py-2">
              {rows.map((r) => (
                <Link key={r.href} href={r.href} onClick={() => setOpen(false)}
                  className={cn("flex items-center gap-4 px-5 py-3.5 text-[15px] hover:bg-secondary", pathname === r.href && "bg-secondary font-medium")}>
                  <r.icon className="size-5 text-muted-foreground" aria-hidden /> {r.label}
                </Link>
              ))}
            </nav>
            {printingOn && (
              <Link href="/printing" onClick={() => setOpen(false)} className="mx-4 mt-auto mb-6 flex items-center gap-3 rounded-2xl bg-primary/10 p-4 hover:bg-primary/15" data-testid="drawer-printing">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-primary">{t("printTitle")}</span>
                  <span className="block text-sm text-muted-foreground">{t("printText")}</span>
                </span>
                <Printer className="size-10 shrink-0 text-primary" aria-hidden />
              </Link>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
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
