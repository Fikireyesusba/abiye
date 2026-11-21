import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Tag } from "lucide-react";
import { CopyButton } from "@/components/shop/copy-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCustomer } from "@/lib/account/session";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("account.offers"), robots: { index: false } };
}

export default async function MyOffersPage() {
  await requireCustomer("/account/offers");
  const [t, locale] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>]);
  const { data: offers } = await (await createSupabaseServerClient()).rpc("my_offers");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/account" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t("account.title")}</Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("account.offers")}</h1>
      {!offers?.length ? <p className="text-sm text-muted-foreground">{t("account.noOffers")}</p> : (
          <Card id="offers" className="scroll-mt-24 border-accent/50 bg-accent/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Tag className="size-5" aria-hidden /> {t("account.offers")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("account.offersHint")}</p>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-3 sm:grid-cols-2">
                {offers.map((o) => (
                  <li key={o.code} className="space-y-1 rounded-lg border bg-card p-3 text-sm">
                    <p className="font-semibold">{(locale === "am" ? o.title_am : o.title_en) || o.title_en}</p>
                    {(locale === "am" ? o.description_am : o.description_en) && <p className="text-muted-foreground">{locale === "am" ? o.description_am : o.description_en}</p>}
                    <p className="font-medium">
                      {o.discount_type === "percent" ? t("home.percentOff", { value: Number(o.discount_value) }) : t("home.amountOff", { amount: formatETB(toSantim(o.discount_value), locale) })}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border border-dashed border-primary/50 bg-primary/5 px-2 py-1 font-mono text-base font-semibold tracking-wide">{o.code}</span>
                      <CopyButton value={o.code} />
                    </div>
                    {Number(o.min_order_etb) > 0 && <p className="text-xs text-muted-foreground">{t("account.offerMin", { amount: formatETB(toSantim(o.min_order_etb), locale) })}</p>}
                    {o.ends_at && <p className="text-xs text-muted-foreground">{t("account.offerUntil", { date: formatDateTime(o.ends_at, locale) })}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
      )}
    </div>
  );
}
