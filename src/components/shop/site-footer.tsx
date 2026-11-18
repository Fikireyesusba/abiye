import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { getSiteSettings } from "@/lib/catalog/settings";
import { formatEthiopianPhone, normalizeEthiopianPhone } from "@/lib/validation/phone";
import type { Locale } from "@/i18n/config";

export async function SiteFooter() {
  const [s, t, locale] = await Promise.all([getSiteSettings(), getTranslations(), getLocale() as Promise<Locale>]);
  const name = s.business.name[locale] || s.business.name.en;
  const phone = normalizeEthiopianPhone(s.contact.phone);
  const social = Object.entries(s.social).filter(([, url]) => !!url) as [string, string][];

  return (
    <footer className="mt-16 border-t bg-sidebar text-sidebar-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <p className="text-lg font-semibold">{name}</p>
          <p className="text-sm opacity-80">{s.business.tagline[locale] || s.business.tagline.en}</p>
          <p className="text-xs opacity-70">{t("footer.payments")}</p>
        </div>
        <nav className="space-y-3 text-sm" aria-label={t("footer.shop")}>
          <p className="font-semibold">{t("footer.shop")}</p>
          <ul className="space-y-2 opacity-85">
            {(["shop", "cosmetics", "electronics", "printing"] as const).map((k) => (
              <li key={k}>
                <Link href={`/${k}`} className="hover:underline">
                  {t(`nav.${k}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav className="space-y-3 text-sm" aria-label={t("footer.help")}>
          <p className="font-semibold">{t("footer.help")}</p>
          <ul className="space-y-2 opacity-85">
            {(["about", "contact", "privacy", "terms"] as const).map((k) => (
              <li key={k}>
                <Link href={`/${k}`} className="hover:underline">
                  {t(`nav.${k}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-3 text-sm">
          <p className="font-semibold">{t("footer.contact")}</p>
          <ul className="space-y-2 opacity-85">
            {phone && (
              <li className="flex gap-2">
                <Phone className="mt-0.5 size-4 shrink-0" aria-hidden />
                <a href={`tel:${phone}`} className="hover:underline">{formatEthiopianPhone(phone)}</a>
              </li>
            )}
            {s.contact.email && (
              <li className="flex gap-2">
                <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
                <a href={`mailto:${s.contact.email}`} className="break-all hover:underline">{s.contact.email}</a>
              </li>
            )}
            {(s.contact.address[locale] || s.contact.address.en) && (
              <li className="flex gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{s.contact.address[locale] || s.contact.address.en}</span>
              </li>
            )}
            {(s.hours[locale] || s.hours.en) && (
              <li className="flex gap-2">
                <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{s.hours[locale] || s.hours.en}</span>
              </li>
            )}
          </ul>
          {social.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-2">
              {social.map(([network, url]) => (
                <a key={network} href={url} target="_blank" rel="noopener noreferrer" className="text-xs capitalize underline-offset-4 opacity-85 hover:underline">
                  {network}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs opacity-70">
        © {new Date().getFullYear()} {name}. {t("footer.rights")}
      </div>
    </footer>
  );
}
