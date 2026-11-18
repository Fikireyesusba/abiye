import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TrackForm } from "@/components/shop/track-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("track");
  return { title: t("title"), robots: { index: false } };
}

export default async function TrackOrderPage() {
  const t = await getTranslations("track");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
      <p className="mb-6 text-muted-foreground">{t("intro")}</p>
      <TrackForm />
    </div>
  );
}
