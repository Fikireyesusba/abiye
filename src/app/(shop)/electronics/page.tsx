import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Catalog } from "@/components/shop/catalog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("electronics") };
}

export default async function ElectronicsPage({ searchParams }: PageProps<"/electronics">) {
  const t = await getTranslations();
  return (
    <Catalog
      basePath="/electronics"
      department="electronics"
      title={t("nav.electronics")}
      description={t("home.electronicsText")}
      searchParams={await searchParams}
    />
  );
}
