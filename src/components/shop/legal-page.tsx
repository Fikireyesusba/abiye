import { getLocale, getTranslations } from "next-intl/server";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { LegalSection } from "@/content/legal";
import type { Locale } from "@/i18n/config";
import { PageShell } from "./page-shell";

export async function LegalPage({ title, content }: { title: string; content: Record<Locale, LegalSection[]> }) {
  const [locale, s, t] = await Promise.all([getLocale() as Promise<Locale>, getSiteSettings(), getTranslations("pages")]);
  const name = s.business.name[locale] || s.business.name.en;
  return (
    <PageShell title={title}>
      <p className="mb-8 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{t("draftNotice")}</p>
      <div className="space-y-6">
        {content[locale].map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            <p className="leading-relaxed text-muted-foreground">{section.body.replaceAll("{name}", name)}</p>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
