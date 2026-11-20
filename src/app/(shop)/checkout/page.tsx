import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { getCustomerAccount, requireCustomer } from "@/lib/account/session";
import { getSiteSettings } from "@/lib/catalog/settings";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checkout");
  return { title: t("title"), robots: { index: false } };
}

export default async function CheckoutPage() {
  // Only signed-in customers can order (also enforced by the server action and the database).
  const user = await requireCustomer("/checkout");
  const [t, s, locale, account] = await Promise.all([getTranslations("checkout"), getSiteSettings(), getLocale() as Promise<Locale>, getCustomerAccount(user.id)]);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
      <CheckoutForm
        shopAddress={s.contact.address[locale] || s.contact.address.en}
        email={user.email}
        defaults={{
          fullName: account?.full_name ?? "", phone: account?.phone ? formatEthiopianPhone(account.phone) : "",
          address: account?.default_address ?? "", zoneId: account?.default_zone_id ?? null,
        }}
        walletBalance={Number(account?.wallet_balance_etb ?? 0)}
      />
    </div>
  );
}
