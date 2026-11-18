import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Printer, Smartphone, Sparkles } from "lucide-react";
import { PageShell } from "@/components/shop/page-shell";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("aboutTitle") };
}

export default async function AboutPage() {
  const [t, s, locale] = await Promise.all([getTranslations(), getSiteSettings(), getLocale() as Promise<Locale>]);
  const pick = (v: { en: string; am: string }) => v[locale] || v.en;
  const items = [
    { icon: Sparkles, title: t("nav.cosmetics"), text: t("home.cosmeticsText"), tone: "bg-cosmetics/10 text-cosmetics" },
    { icon: Smartphone, title: t("nav.electronics"), text: t("home.electronicsText"), tone: "bg-electronics/10 text-electronics" },
    { icon: Printer, title: t("nav.printing"), text: t("home.printingText"), tone: "bg-printing/10 text-printing" },
  ];
  return (
    <PageShell title={t("pages.aboutTitle")}>
      <p className="mb-8 text-lg text-muted-foreground">
        <strong className="text-foreground">{pick(s.business.name)}</strong> — {pick(s.business.tagline)}
      </p>
      <ul className="space-y-4">
        {items.map((i) => (
          <li key={i.title} className="flex gap-4 rounded-xl border bg-card p-5">
            <span className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg ${i.tone}`}>
              <i.icon className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{i.title}</h2>
              <p className="text-sm text-muted-foreground">{i.text}</p>
            </div>
          </li>
        ))}
      </ul>
      {s.homepage.why_us.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">{t("home.whyUs")}</h2>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            {s.homepage.why_us.map((w, i) => <li key={i}>{pick(w)}</li>)}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
