import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checkout");
  return { title: t("title"), robots: { index: false } };
}

export default async function CheckoutPage() {
  const [t, s, locale] = await Promise.all([getTranslations("checkout"), getSiteSettings(), getLocale() as Promise<Locale>]);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
      <CheckoutForm shopAddress={s.contact.address[locale] || s.contact.address.en} />
    </div>
  );
}
