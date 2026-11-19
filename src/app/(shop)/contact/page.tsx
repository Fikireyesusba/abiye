import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Clock, Landmark, MapPin } from "lucide-react";
import { CopyButton } from "@/components/shop/copy-button";
import { PageShell } from "@/components/shop/page-shell";
import { socialLinks } from "@/components/shop/social-links";
import { getPublicBankAccounts } from "@/lib/catalog/bank-info";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("contactTitle") };
}

export default async function ContactPage() {
  const [t, s, locale, banks] = await Promise.all([getTranslations(), getSiteSettings(), getLocale() as Promise<Locale>, getPublicBankAccounts()]);
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

      {banks.length > 0 && (
        <section aria-labelledby="pay" className="mt-10 space-y-3">
          <h2 id="pay" className="flex items-center gap-2 text-xl font-semibold"><Landmark className="size-5 text-primary" aria-hidden /> {t("payInfo.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("payInfo.intro")}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {banks.map((b) => (
              <li key={b.id} className="space-y-2 rounded-xl border bg-card p-4 text-sm">
                <p className="text-base font-semibold">{b.bank_name}</p>
                <p><span className="text-muted-foreground">{t("payInfo.holder")}: </span>{b.account_holder}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t("payInfo.number")}:</span>
                  <span className="font-mono text-base tracking-wider">{b.account_number}</span>
                  <CopyButton value={b.account_number.replace(/[\s-]/g, "")} label={`${b.bank_name} ${t("payInfo.number")}`} />
                </div>
                {b.branch && <p><span className="text-muted-foreground">{t("payInfo.branch")}: </span>{b.branch}</p>}
                {(locale === "am" ? b.instructions_am || b.instructions_en : b.instructions_en) && (
                  <p className="text-muted-foreground">{locale === "am" ? b.instructions_am || b.instructions_en : b.instructions_en}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
