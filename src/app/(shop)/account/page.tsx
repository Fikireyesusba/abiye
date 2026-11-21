import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Bell, LogOut, Package, Tag, Wallet } from "lucide-react";
import { ProfileForm } from "@/components/account/auth-forms";
import { PushToggle } from "@/components/pwa/push";
import { getServerEnv } from "@/lib/env";
import { CopyButton } from "@/components/shop/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutCustomer } from "@/lib/account/actions";
import { getCustomerAccount, requireCustomer } from "@/lib/account/session";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import { localized, type Locale } from "@/i18n/config";
import { getDeliveryZones } from "@/lib/catalog/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireCustomer("/account");
  const vapid = getServerEnv().VAPID_PRIVATE_KEY && getServerEnv().VAPID_SUBJECT ? (getServerEnv().VAPID_PUBLIC_KEY ?? null) : null;
  const sp = await searchParams;
  const [t, locale, account, zones] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>, getCustomerAccount(user.id), getDeliveryZones()]);
  // RLS: a customer can only read their own orders and printing jobs.
  const supabase = await createSupabaseServerClient();
  const [{ count: orderCount }, { data: offers }] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("payment_status", "in", "(unpaid,rejected)"),
    supabase.rpc("my_offers"),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("account.title")}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <form action={signOutCustomer}>
          <Button type="submit" variant="outline" size="sm"><LogOut /> {t("account.signOut")}</Button>
        </form>
      </div>
      {sp.welcome && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">{t("account.welcome")}</p>}
      {sp.passwordChanged && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">{t("account.passwordChanged")}</p>}

      <div className="space-y-6">
        {!!offers?.length && (
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
        <Card>
          <CardHeader><CardTitle>{t("account.personalDetails")}</CardTitle></CardHeader>
          <CardContent>
            <ProfileForm
              zones={zones.map((z) => ({ id: z.id, name: localized(z, "name", locale) }))}
              details={{
                fullName: account?.full_name ?? "", email: user.email,
                phone: account?.phone ? formatEthiopianPhone(account.phone) : "",
                dateOfBirth: account?.date_of_birth ?? "", sex: account?.sex ?? "",
                zoneId: account?.default_zone_id ?? null, address: account?.default_address ?? "",
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 pt-6">
            <Wallet className="size-8 text-primary" aria-hidden />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{t("wallet.card")}</p>
              <p className="text-2xl font-semibold tabular-nums">{formatETB(toSantim(Number(account?.wallet_balance_etb ?? 0)), locale)}</p>
            </div>
            <Button asChild variant="outline"><Link href="/account/wallet">{t("wallet.cardLink")}</Link></Button>
          </CardContent>
        </Card>
        {vapid && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bell className="size-5" aria-hidden /> {t("push.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("push.text")}</p>
            </CardHeader>
            <CardContent><PushToggle vapidPublicKey={vapid} /></CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 pt-6">
            <Package className="size-8 text-primary" aria-hidden />
            <div className="flex-1">
              <p className="font-medium">{t("account.myOrders")}</p>
              <p className="text-sm text-muted-foreground">{t("account.ordersCount", { count: orderCount ?? 0 })}</p>
            </div>
            <Button asChild variant="outline"><Link href="/account/orders">{t("account.showOrders")}</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
