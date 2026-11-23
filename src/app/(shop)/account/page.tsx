import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Bell, ChevronRight, LogOut, Package, Tag, UserRound, Wallet } from "lucide-react";
import { getServerEnv } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { signOutCustomer } from "@/lib/account/actions";
import { getCustomerAccount, requireCustomer } from "@/lib/account/session";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireCustomer("/account");
  const vapid = getServerEnv().VAPID_PRIVATE_KEY && getServerEnv().VAPID_SUBJECT ? (getServerEnv().VAPID_PUBLIC_KEY ?? null) : null;
  const sp = await searchParams;
  const [t, locale, account] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>, getCustomerAccount(user.id)]);
  // RLS: a customer can only read their own orders and printing jobs.
  const supabase = await createSupabaseServerClient();
  const [{ count: orderCount }, { data: offers }] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("payment_status", ["verified", "refunded"]),
    supabase.rpc("my_offers"),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("account.title")}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          {account?.member_id && (
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">{t("account.memberId")}: </span>
              <span className="font-mono font-semibold tracking-widest" data-testid="member-id">{account.member_id}</span>
            </p>
          )}
        </div>
        <form action={signOutCustomer}>
          <Button type="submit" variant="outline" size="sm"><LogOut /> {t("account.signOut")}</Button>
        </form>
      </div>
      {sp.welcome && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">{t("account.welcome")}</p>}
      {sp.passwordChanged && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">{t("account.passwordChanged")}</p>}

      {/* Balance first, then one tappable line per section (each opens its own page). */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <Wallet className="size-8 text-primary" aria-hidden />
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">{t("wallet.card")}</p>
            <p className="text-2xl font-semibold tabular-nums">{formatETB(toSantim(Number(account?.wallet_balance_etb ?? 0)), locale)}</p>
          </div>
          <Button asChild variant="outline"><Link href="/account/wallet">{t("wallet.cardLink")}</Link></Button>
        </CardContent>
      </Card>
      <nav aria-label={t("account.title")}>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="account-menu">
          {[
            { href: "/account/details", icon: UserRound, label: t("account.personalDetails"), hint: account?.full_name || user.email },
            { href: "/account/orders", icon: Package, label: t("account.myOrders"), hint: t("account.ordersCount", { count: orderCount ?? 0 }) },
            ...(vapid ? [{ href: "/account/notifications", icon: Bell, label: t("push.title"), hint: t("account.notificationsHint") }] : []),
            ...(offers?.length ? [{ href: "/account/offers", icon: Tag, label: t("account.offers"), hint: t("account.offersCount", { count: offers.length }), highlight: true }] : []),
          ].map((row) => (
            <li key={row.href}>
              <Link href={row.href} className="flex items-center gap-4 px-4 py-4 hover:bg-muted/40">
                <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${"highlight" in row && row.highlight ? "bg-accent/20 text-accent-foreground" : "bg-primary/10 text-primary"}`}>
                  <row.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{row.label}</span>
                  <span className="block truncate text-sm text-muted-foreground">{row.hint}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
