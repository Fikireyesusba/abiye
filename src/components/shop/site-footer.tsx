import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { InstallAppButton } from "@/components/pwa/pwa";
import { socialLinks, SocialIconRow } from "./social-links";
import { getSiteSettings } from "@/lib/catalog/settings";
import { getCustomerUser } from "@/lib/account/session";
import { formatEthiopianPhone, normalizeEthiopianPhone } from "@/lib/validation/phone";
import type { Locale } from "@/i18n/config";

export async function SiteFooter() {
  const [s, t, locale, viewer] = await Promise.all([getSiteSettings(), getTranslations(), getLocale() as Promise<Locale>, getCustomerUser()]);
  const name = s.business.name[locale] || s.business.name.en;
  const phone = normalizeEthiopianPhone(s.contact.phone);
  const links = socialLinks(s);

  return (
    <footer className="mt-16 border-t bg-sidebar text-sidebar-foreground">
      {/* Help and the shop's contact details side by side (also on phones); no bank / shop details here.
          Not shown to signed-in customers or inside the installed app: both are in the profile menu there. */}
      {!viewer && (
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 app:hidden lg:grid-cols-[1fr_1fr_1fr]" data-testid="footer-links">
        <nav className="space-y-3 text-sm" aria-label={t("footer.help")}>
          <p className="font-semibold">{t("footer.help")}</p>
          <ul className="space-y-2 opacity-85">
            {([["help", "/help"], ["about", "/about"], ["privacy", "/privacy"], ["terms", "/terms"]] as const).map(([k, href]) => (
              <li key={k}>
                <Link href={href} className="hover:underline">
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
              <li className="flex min-w-0 gap-2">
                <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
                <a href={`mailto:${s.contact.email}`} className="min-w-0 break-all hover:underline">{s.contact.email}</a>
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
          <SocialIconRow links={links.filter((l) => l.external)} className="pt-1" />
        </div>
        <div className="col-span-2 space-y-3 text-sm lg:col-span-1">
          <div className="space-y-2">
            <p className="font-semibold">{t("pwa.helpTitle")}</p>
            <InstallAppButton variant="default" className="bg-accent text-accent-foreground hover:bg-accent/90 [&:is(p)]:bg-transparent [&:is(p)]:text-current [&:is(p)]:opacity-85" />
          </div>
        </div>
      </div>
      )}
      {viewer && (
        <div className="mx-auto max-w-7xl px-4 pt-6 app:hidden">
          <InstallAppButton variant="default" className="bg-accent text-accent-foreground hover:bg-accent/90 [&:is(p)]:bg-transparent [&:is(p)]:text-current [&:is(p)]:opacity-85" />
        </div>
      )}
      <div className="border-t border-white/10 py-5 text-center text-xs opacity-70 app:border-0">
        © {new Date().getFullYear()} {name}. {t("footer.rights")}
      </div>
    </footer>
  );
}
