import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPrintingPrices } from "@/lib/catalog/queries";
import { getSiteSettings } from "@/lib/catalog/settings";
import { formatETB, toSantim } from "@/lib/money";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return { title: t("printingTitle") };
}

/**
 * Phase 2: live price list from the database. Online upload, page counting
 * and ordering are added in Phase 5.
 */
export default async function PrintingPage() {
  const [t, locale, prices, s] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>, getPrintingPrices(), getSiteSettings()]);
  const charge = s.printing.service_charge_etb;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
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

      <div className="mt-8 flex flex-col items-start gap-4 rounded-xl border border-dashed p-6 sm:flex-row sm:items-center">
        <FileText className="size-8 shrink-0 text-muted-foreground" aria-hidden />
        <p className="flex-1 text-sm text-muted-foreground">{t("pages.onlineSoon")}</p>
        <Button variant="outline" asChild>
          <Link href="/contact">{t("nav.contact")}</Link>
        </Button>
      </div>
    </div>
  );
}
