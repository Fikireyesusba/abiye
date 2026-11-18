import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { PageShell } from "@/components/shop/page-shell";
import { getSiteSettings } from "@/lib/catalog/settings";
import { formatEthiopianPhone, normalizeEthiopianPhone } from "@/lib/validation/phone";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("contactTitle") };
}

export default async function ContactPage() {
  const [t, s, locale] = await Promise.all([getTranslations(), getSiteSettings(), getLocale() as Promise<Locale>]);
  const pick = (v: { en: string; am: string }) => v[locale] || v.en;
  const phone = normalizeEthiopianPhone(s.contact.phone);
  const telegram = s.contact.telegram?.replace(/^@/, "");
  const rows = [
    phone && { icon: Phone, label: t("pages.phone"), value: formatEthiopianPhone(phone), href: `tel:${phone}` },
    s.contact.email && { icon: Mail, label: t("pages.email"), value: s.contact.email, href: `mailto:${s.contact.email}` },
    telegram && /^[A-Za-z0-9_]{5,32}$/.test(telegram) && { icon: MessageCircle, label: t("pages.telegram"), value: `@${telegram}`, href: `https://t.me/${telegram}` },
    pick(s.contact.address) && { icon: MapPin, label: t("pages.address"), value: pick(s.contact.address), href: s.contact.map_url ?? undefined },
    pick(s.hours) && { icon: Clock, label: t("footer.hours"), value: pick(s.hours) },
  ].filter(Boolean) as { icon: typeof Phone; label: string; value: string; href?: string }[];

  return (
    <PageShell title={t("pages.contactTitle")}>
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.label} className="flex gap-4 rounded-xl border bg-card p-5">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <r.icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{r.label}</p>
              {r.href ? (
                <a href={r.href} className="font-medium break-words hover:text-primary" {...(r.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {r.value}
                </a>
              ) : (
                <p className="font-medium">{r.value}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
