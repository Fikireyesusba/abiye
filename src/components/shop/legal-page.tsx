import { getLocale, getTranslations } from "next-intl/server";
import { parseLegalText } from "@/content/legal";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { Locale } from "@/i18n/config";
import { PageShell } from "./page-shell";

/** Terms / privacy, edited by the business in /admin/settings → Legal. Rendered as plain text only. */
export async function LegalPage({ title, doc }: { title: string; doc: "terms" | "privacy" }) {
  const [locale, s, t] = await Promise.all([getLocale() as Promise<Locale>, getSiteSettings(), getTranslations("pages")]);
  const name = s.business.name[locale] || s.business.name.en;
  const text = s.legal[doc][locale] || s.legal[doc].en;
  return (
    <PageShell title={title}>
      {!s.legal.approved && <p className="mb-8 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{t("draftNotice")}</p>}
      <div className="space-y-6">
        {parseLegalText(text.replaceAll("{name}", name)).map((section, i) => (
          <section key={i} className="space-y-2">
            {section.heading && <h2 className="text-lg font-semibold">{section.heading}</h2>}
            {section.paragraphs.map((p, j) => (
              <p key={j} className="leading-relaxed whitespace-pre-line text-muted-foreground">{p}</p>
            ))}
          </section>
        ))}
      </div>
    </PageShell>
  );
}
