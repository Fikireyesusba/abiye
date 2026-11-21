import { getLocale, getTranslations } from "next-intl/server";
import { PauseCircle } from "lucide-react";
import { getSiteSettings } from "@/lib/catalog/settings";
import type { ServiceKey } from "@/lib/validation/settings";
import type { Locale } from "@/i18n/config";

/** Is this customer service switched on (Admin → Manage services)? */
export async function serviceOn(service: ServiceKey): Promise<boolean> {
  return (await getSiteSettings()).services[service];
}

/** "Temporarily unavailable" notice for a paused service (renders nothing while it is on). */
export async function ServiceNotice({ service, className }: { service: ServiceKey; className?: string }) {
  const [s, t, locale] = await Promise.all([getSiteSettings(), getTranslations("services"), getLocale() as Promise<Locale>]);
  if (s.services[service]) return null;
  const note = s.services.note[locale] || s.services.note.en;
  return (
    <div role="status" data-service-off={service}
      className={`flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 ${className ?? ""}`}>
      <PauseCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{t(`off_${service}`)}</p>
        {note && <p className="mt-1">{note}</p>}
      </div>
    </div>
  );
}
