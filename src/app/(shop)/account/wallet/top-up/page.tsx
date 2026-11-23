import type { Metadata } from "next";
import { scanMaxMb } from "@/lib/security/virus-scan";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { TopupForm } from "@/components/account/topup-form";
import { CopyButton } from "@/components/shop/copy-button";
import { ServiceNotice, serviceOn } from "@/components/shop/service-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCustomer } from "@/lib/account/session";
import { getPublicBankAccounts } from "@/lib/catalog/bank-info";
import { formatETB, toSantim } from "@/lib/money";
import { WALLET_MAX_ETB } from "@/lib/wallet/limits";
import { getMyWallet } from "@/lib/wallet/queries";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wallet");
  return { title: t("topUp"), robots: { index: false } };
}

/** Top up: our bank account(s), the steps (exact amount, reason "Top Up"), then amount + receipt. */
export default async function TopUpPage() {
  const user = await requireCustomer("/account/wallet/top-up");
  const [t, locale, w, banks] = await Promise.all([getTranslations("wallet"), getLocale() as Promise<Locale>, getMyWallet(user.id), getPublicBankAccounts()]);
  const etb = (n: number) => formatETB(toSantim(n), locale);
  const room = Math.max(0, WALLET_MAX_ETB - w.balance - w.pending);
  const on = await serviceOn("wallet");
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8 sm:py-12">
      <Link href="/account/wallet" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t("title")}</Link>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("topUp")}</h1>
      <p className="text-sm text-muted-foreground">{t("topUpIntro", { balance: etb(w.balance), room: etb(room) })}</p>
      <ServiceNotice service="wallet" />
      {banks.length === 0 ? <p className="text-sm text-muted-foreground">{t("noBank")}</p> : (
        <>
          <Card>
            <CardHeader><CardTitle>{t("bankTitle")}</CardTitle></CardHeader>
            <CardContent className="space-y-3" data-testid="topup-banks">
              {banks.map((b) => (
                <div key={b.account_number} className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <span className="block font-medium">{b.bank_name}</span>
                  <span className="block">{b.account_holder}</span>
                  <span className="flex items-center gap-2 font-mono text-base">{b.account_number} <CopyButton value={b.account_number.replace(/[\s-]/g, "")} /></span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("stepsTitle")}</CardTitle></CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-2 pl-5 text-sm" data-testid="topup-steps">
                <li>{t("stepAmount")}</li>
                <li>{t("stepTransfer")}</li>
                <li><span className="font-medium">{t("stepReason")}</span> <span className="ml-1 inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-mono">Top Up <CopyButton value="Top Up" /></span></li>
                <li>{t("stepExact")}</li>
                <li>{t("stepReceipt")}</li>
              </ol>
            </CardContent>
          </Card>
          {on && (
            <Card>
              <CardHeader><CardTitle>{t("formTitle")}</CardTitle></CardHeader>
              <CardContent><TopupForm maxAmount={room} maxMb={scanMaxMb()} /></CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
