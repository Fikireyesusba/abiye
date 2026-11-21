import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Wallet } from "lucide-react";
import { TopupForm } from "@/components/account/topup-form";
import { CopyButton } from "@/components/shop/copy-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCustomer } from "@/lib/account/session";
import { getPublicBankAccounts } from "@/lib/catalog/bank-info";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { WALLET_MAX_ETB } from "@/lib/wallet/limits";
import { getMyWallet } from "@/lib/wallet/queries";
import type { Locale } from "@/i18n/config";
import { ServiceNotice, serviceOn } from "@/components/shop/service-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wallet");
  return { title: t("title"), robots: { index: false } };
}

export default async function WalletPage() {
  const user = await requireCustomer("/account/wallet");
  const [t, locale, w, banks] = await Promise.all([getTranslations("wallet"), getLocale() as Promise<Locale>, getMyWallet(user.id), getPublicBankAccounts()]);
  const etb = (n: number) => formatETB(toSantim(n), locale);
  const room = Math.max(0, WALLET_MAX_ETB - w.balance - w.pending);
  const bank = banks[0];
  const kind = (k: string) => t(`kind_${k}` as "kind_topup");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <Link href="/account" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t("back")}</Link>
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl"><Wallet className="size-7 text-primary" aria-hidden /> {t("title")}</h1>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div><p className="text-sm text-muted-foreground">{t("balance")}</p><p className="text-3xl font-semibold tabular-nums">{etb(w.balance)}</p></div>
          <div><p className="text-sm text-muted-foreground">{t("pending")}</p><p className="text-xl font-medium tabular-nums">{etb(w.pending)}</p></div>
          <div><p className="text-sm text-muted-foreground">{t("limit")}</p><p className="text-xl font-medium tabular-nums">{etb(WALLET_MAX_ETB)}</p></div>
          <p className="text-sm text-muted-foreground sm:col-span-3">{t("explain")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("topUp")}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {bank ? (
            <ol className="space-y-2 text-sm">
              <li>1. {t("step1")}</li>
              <li className="rounded-lg border bg-muted/40 p-3">
                <span className="block font-medium">{bank.bank_name}</span>
                <span className="block">{bank.account_holder}</span>
                <span className="flex items-center gap-2 font-mono text-base">{bank.account_number} <CopyButton value={bank.account_number} /></span>
              </li>
              <li>2. {t("step2", { email: user.email })}</li>
              <li>3. {t("step3")}</li>
            </ol>
          ) : <p className="text-sm text-muted-foreground">{t("noBank")}</p>}
          <ServiceNotice service="wallet" />
          {bank && (await serviceOn("wallet")) && <TopupForm maxAmount={room} />}
        </CardContent>
      </Card>

      {w.topups.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("requests")}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {w.topups.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-mono">{x.topup_number}</span>
                  <span className="tabular-nums">{etb(Number(x.amount_etb))}</span>
                  <Badge variant={x.status === "verified" ? "success" : x.status === "rejected" ? "destructive" : "warning"}>{t(`status_${x.status}` as "status_pending")}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(x.created_at, locale)}</span>
                  {x.status === "rejected" && x.review_note && <span className="w-full text-xs text-destructive">{x.review_note}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("history")}</CardTitle></CardHeader>
        <CardContent>
          {w.ledger.length === 0 ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : (
            <ul className="divide-y text-sm">
              {w.ledger.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">{kind(l.kind)}</span>
                  {l.note && <span className="text-xs text-muted-foreground">{l.note}</span>}
                  <span className={`ml-auto tabular-nums ${Number(l.amount_etb) > 0 ? "text-success" : ""}`}>{Number(l.amount_etb) > 0 ? "+" : "−"}{etb(Math.abs(Number(l.amount_etb)))}</span>
                  <span className="w-full text-xs text-muted-foreground sm:w-auto">{formatDateTime(l.created_at, locale)} · {t("after", { amount: etb(Number(l.balance_after_etb)) })}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
