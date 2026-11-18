import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Catalog } from "@/components/shop/catalog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("catalog");
  return { title: t("allProducts") };
}

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const t = await getTranslations("catalog");
  return <Catalog basePath="/shop" title={t("allProducts")} searchParams={await searchParams} />;
}
