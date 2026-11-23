import type { Metadata } from "next";
import { scanMaxMb } from "@/lib/security/virus-scan";
import { getLocale, getTranslations } from "next-intl/server";
import { Printer } from "lucide-react";
import Link from "next/link";
import { PrintForm } from "@/components/shop/print-form";
import { Button } from "@/components/ui/button";
import { getCustomerAccount, getCustomerUser } from "@/lib/account/session";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import { getDeliveryZones, getPrintingPrices } from "@/lib/catalog/queries";
import { getSiteSettings } from "@/lib/catalog/settings";
import { formatETB, toSantim } from "@/lib/money";
import type { Locale } from "@/i18n/config";
import { ServiceNotice } from "@/components/shop/service-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("printingTitle") };
}

/** Online printing: upload → server page count → priced job (or staff quote) → basket → bank transfer. */
export default async function PrintingPage() {
  const [t, locale, prices, s, zones] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>, getPrintingPrices(), getSiteSettings(), getDeliveryZones()]);
  const charge = s.printing.service_charge_etb;
  const user = await getCustomerUser();
  const account = user ? await getCustomerAccount(user.id) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8 space-y-3">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-printing/12 text-printing">
          <Printer className="size-6" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("pages.printingTitle")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("pages.printingIntro")}</p>
      </header>

      <section className="overflow-hidden rounded-xl border bg-card">
        <h2 className="border-b px-4 py-3 font-semibold">{t("pages.priceList")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t("pages.size")}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t("pages.type")}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t("pages.sidesLabel")}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t("pages.pricePerPage")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {prices.map((p) => (
                <tr key={`${p.paper_size}-${p.color_mode}-${p.sides}`}>
                  <td className="px-4 py-2.5 font-medium">{p.paper_size}</td>
                  <td className="px-4 py-2.5">{t(`printing.${p.color_mode}`)}</td>
                  <td className="px-4 py-2.5">{t(`printing.${p.sides}`)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatETB(toSantim(p.price_per_page_etb), locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {charge > 0 && (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">
            {t("pages.serviceCharge", { amount: formatETB(toSantim(charge), locale) })}
          </p>
        )}
      </section>

      <section className="mt-10 space-y-4" aria-labelledby="order-online">
        <h2 id="order-online" className="text-xl font-semibold">{t("printing.formTitle")}</h2>
        <ol className="grid gap-3 text-sm sm:grid-cols-4">
          {(["step1", "step2", "step3", "step4"] as const).map((k, i) => (
            <li key={k} className="flex gap-3 rounded-lg bg-printing/8 p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-printing text-xs font-semibold text-white">{i + 1}</span>
              <span>{t(`printing.${k}`)}</span>
            </li>
          ))}
        </ol>
        <ServiceNotice service="printing" />
        {!s.services.printing ? null : user ? (
        <PrintForm
          defaults={{ fullName: account?.full_name ?? "", phone: account?.phone ? formatEthiopianPhone(account.phone) : "" }}
          rules={prices}
          serviceCharge={charge}
          maxMb={Math.min(25, s.printing.max_file_mb, scanMaxMb())}
          maxCopies={s.printing.max_copies}
          pickupEnabled={s.delivery.pickup_enabled}
          deliveryEnabled={s.delivery.delivery_enabled && zones.length > 0}
        />
        ) : (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed p-6 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm">{t("account.signInToPrint")}</p>
            <div className="flex gap-2">
              <Button asChild><Link href="/account/login?next=/printing">{t("account.signIn")}</Link></Button>
              <Button variant="outline" asChild><Link href="/account/signup?next=/printing">{t("account.signUp")}</Link></Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
