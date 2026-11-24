import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { IdleSignOut } from "@/components/security/idle-sign-out";
import { IDLE_MINUTES } from "@/lib/security/idle";
import { InstallBanner } from "@/components/pwa/pwa";
import { PushClaim } from "@/components/pwa/push-claim";
import { AppOpenPing } from "@/components/pwa/app-open-ping";
import { getCustomerUser } from "@/lib/account/session";
import { RatePrompt } from "@/components/shop/rate-ticket";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  // A resolved / closed ticket not rated yet: ask for 1–5 stars (RLS: own tickets, closed ones for 24 h).
  // New accounts wait for approval: shown on every page (they can browse and use Support meanwhile).
  const { data: approval } = viewer
    ? await (await createSupabaseServerClient()).from("customer_accounts").select("approval_status").eq("id", viewer.id).maybeSingle()
    : { data: null };
  const pending = approval?.approval_status === "pending";
  const { data: toRate } = viewer
    ? await (await createSupabaseServerClient()).from("support_tickets").select("id, ticket_number").eq("user_id", viewer.id)
        .in("status", ["resolved", "closed"]).is("rating", null).order("updated_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  return (
    <>
      <IdleSignOut minutes={IDLE_MINUTES.customer} kind="customer" warning={{ text: t("idleWarning"), stay: t("idleStay") }} />
      <SiteHeader />
      {pending && (
        <div role="status" className="border-b border-warning/40 bg-warning/10 px-4 py-3 text-sm" data-testid="account-pending">
          <div className="mx-auto max-w-7xl">
            <strong>{t("pendingTitle")}</strong> {t("pendingText")}
          </div>
        </div>
      )}
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
      <Toaster />
      <CartSync />
      <InstallBanner />
      <PushClaim />
      <AppOpenPing account={viewer?.id ?? ""} />
      <RatePrompt ticket={toRate ? { id: toRate.id, number: toRate.ticket_number } : null} />
    </>
  );
}
