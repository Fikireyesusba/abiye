import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { getSiteSettings } from "@/lib/catalog/settings";
import { publicImageUrl } from "@/lib/storage";
import type { Locale } from "@/i18n/config";
import { AccountButton, CartButton, DesktopNav, LanguageSwitcher, MobileNav } from "./header-client";

export async function SearchForm({ defaultValue, className }: { defaultValue?: string; className?: string }) {
  const t = await getTranslations();
  return (
    <form action="/shop" method="get" role="search" className={className}>
      <label htmlFor="site-search" className="sr-only">
        {t("header.searchLabel")}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="site-search"
          name="q"
          type="search"
          defaultValue={defaultValue}
          maxLength={60}
          placeholder={t("common.search")}
          className="h-10 w-full rounded-full border border-input bg-card pr-4 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
    </form>
  );
}

export async function SiteHeader() {
  const [settings, t, locale] = await Promise.all([getSiteSettings(), getTranslations(), getLocale() as Promise<Locale>]);
  const name = settings.business.name[locale] || settings.business.name.en;
  const logo = publicImageUrl("site-assets", settings.business.logo_path);
  const links = [
    { href: "/shop", label: t("nav.shop") },
    { href: "/cosmetics", label: t("nav.cosmetics") },
    { href: "/electronics", label: t("nav.electronics") },
    { href: "/printing", label: t("nav.printing") },
  ];
  const secondary = [
    { href: "/account", label: t("account.title") },
    { href: "/track-order", label: t("nav.trackOrder") },
    { href: "/about", label: t("nav.about") },
    { href: "/contact", label: t("nav.contact") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        {t("header.skipToContent")}
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4">
        <MobileNav links={[{ href: "/", label: t("nav.home") }, ...links]} secondary={secondary} title={name} />
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          {logo ? (
            <Image src={logo} alt={name} width={120} height={36} className="h-9 w-auto" priority />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-lg text-primary-foreground" aria-hidden>
              {(name.match(/[\p{L}\p{N}]/u)?.[0] ?? "S").toUpperCase()}
            </span>
          )}
          <span className="hidden max-w-[12rem] truncate text-lg sm:inline">{name}</span>
        </Link>
        <DesktopNav links={links} />
        <SearchForm className="ml-auto hidden w-full max-w-xs md:block" />
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <LanguageSwitcher className="hidden sm:inline-flex" />
          <AccountButton />
          <CartButton />
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <SearchForm />
      </div>
    </header>
  );
}
