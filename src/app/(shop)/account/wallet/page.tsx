import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCustomer } from "@/lib/account/session";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { WALLET_MAX_ETB } from "@/lib/wallet/limits";
import { getMyWallet } from "@/lib/wallet/queries";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wallet");
  return { title: t("title"), robots: { index: false } };
}

export default async function WalletPage() {
  const user = await requireCustomer("/account/wallet");
  const [t, locale, w] = await Promise.all([getTranslations("wallet"), getLocale() as Promise<Locale>, getMyWallet(user.id)]);
  const etb = (n: number) => formatETB(toSantim(n), locale);
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

      <Button asChild size="lg" className="w-full sm:w-auto" data-testid="topup-button">
        <Link href="/account/wallet/top-up"><Plus /> {t("topUp")}</Link>
      </Button>

      {/* A top-up counts once it is accepted (then it appears in the history below). One still being checked is only mentioned. */}
      {w.topups.some((x) => x.status === "pending") && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" role="status" data-testid="topup-in-review">
          {t("inReview", { amount: etb(w.topups.filter((x) => x.status === "pending").reduce((n, x) => n + Number(x.amount_etb), 0)) })}
        </p>
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
