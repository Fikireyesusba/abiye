import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Clock, MapPin } from "lucide-react";
import { PageShell } from "@/components/shop/page-shell";
import { socialLinks } from "@/components/shop/social-links";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("contactTitle") };
}

export default async function ContactPage() {
  const [t, s, locale] = await Promise.all([getTranslations(), getSiteSettings(), getLocale() as Promise<Locale>]);
  const pick = (v: { en: string; am: string }) => v[locale] || v.en;
  const links = socialLinks(s);

  return (
    <PageShell title={t("pages.contactTitle")}>
      <section aria-labelledby="reach" className="space-y-3">
        <h2 id="reach" className="sr-only">{t("payInfo.reachUs")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {links.map((l) => (
            <li key={l.key}>
              <a href={l.href} className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md"
                {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{l.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm text-muted-foreground">{l.key === "whatsapp" ? t("payInfo.whatsapp") : l.key === "phone" ? t("pages.phone") : l.key === "email" ? t("pages.email") : l.label}</span>
                  <span className="block truncate font-medium">{l.display}</span>
                </span>
              </a>
            </li>
          ))}
          {pick(s.contact.address) && (
            <li className="flex items-center gap-4 rounded-xl border bg-card p-4">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><MapPin className="size-5" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-sm text-muted-foreground">{t("pages.address")}</span>
                {s.contact.map_url ? (
                  <a href={s.contact.map_url} target="_blank" rel="noopener noreferrer" className="block font-medium hover:text-primary">{pick(s.contact.address)}</a>
                ) : <span className="block font-medium">{pick(s.contact.address)}</span>}
              </span>
            </li>
          )}
          {pick(s.hours) && (
            <li className="flex items-center gap-4 rounded-xl border bg-card p-4">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Clock className="size-5" aria-hidden /></span>
              <span><span className="block text-sm text-muted-foreground">{t("footer.hours")}</span><span className="block font-medium">{pick(s.hours)}</span></span>
            </li>
          )}
        </ul>
      </section>
    </PageShell>
  );
}
