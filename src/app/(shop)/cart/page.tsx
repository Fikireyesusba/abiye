import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CartView } from "@/components/shop/cart-view";
import { ServiceNotice } from "@/components/shop/service-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cart");
  return { title: t("title"), robots: { index: false } };
}

export default async function CartPage() {
  const t = await getTranslations("cart");
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
      <ServiceNotice service="shop" className="mb-4" />
      <CartView />
    </div>
  );
}
