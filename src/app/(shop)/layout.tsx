import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { IdleSignOut } from "@/components/security/idle-sign-out";
import { IDLE_MINUTES } from "@/lib/security/idle";
import { InstallBanner } from "@/components/pwa/pwa";
import { PushClaim } from "@/components/pwa/push-claim";
import { AppOpenPing } from "@/components/pwa/app-open-ping";
import { getCustomerUser } from "@/lib/account/session";
import { CartSync } from "@/components/shop/cart-sync";
import { SiteFooter } from "@/components/shop/site-footer";
import { SiteHeader } from "@/components/shop/site-header";
import { Toaster } from "@/components/ui/sonner";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const [s, locale] = await Promise.all([getSiteSettings(), getLocale() as Promise<Locale>]);
  const name = s.business.name[locale] || s.business.name.en;
  return {
    title: { absolute: name, template: `%s · ${name}` },
    description: s.business.tagline[locale] || s.business.tagline.en,
    metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined,
    openGraph: { siteName: name, type: "website", locale: locale === "am" ? "am_ET" : "en_US" },
  };
}

export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const [t, viewer] = await Promise.all([getTranslations("account"), getCustomerUser()]);
  return (
    <>
      <IdleSignOut minutes={IDLE_MINUTES.customer} kind="customer" warning={{ text: t("idleWarning"), stay: t("idleStay") }} />
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
      <Toaster />
      <CartSync />
      <InstallBanner />
      <PushClaim />
      <AppOpenPing account={viewer?.id ?? ""} />
    </>
  );
}
