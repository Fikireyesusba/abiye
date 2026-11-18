import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Catalog } from "@/components/shop/catalog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("cosmetics") };
}

export default async function CosmeticsPage({ searchParams }: PageProps<"/cosmetics">) {
  const t = await getTranslations();
  return (
    <Catalog
      basePath="/cosmetics"
      department="cosmetics"
      title={t("nav.cosmetics")}
      description={t("home.cosmeticsText")}
      searchParams={await searchParams}
    />
  );
}
