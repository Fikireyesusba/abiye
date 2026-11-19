import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LogOut, Tag } from "lucide-react";
import { ProfileForm } from "@/components/account/auth-forms";
import { CopyButton } from "@/components/shop/copy-button";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutCustomer } from "@/lib/account/actions";
import { getCustomerAccount, requireCustomer } from "@/lib/account/session";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireCustomer("/account");
  const sp = await searchParams;
  const [t, locale, account] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>, getCustomerAccount(user.id)]);
  // RLS: a customer can only read their own orders and printing jobs.
  const supabase = await createSupabaseServerClient();
  const { data: staff } = await supabase.rpc("my_admin_context");
  const [{ data: orders }, { data: jobs }, { data: offers }] = await Promise.all([
    supabase.from("orders").select("id, order_number, status, payment_status, total_etb, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("printing_jobs").select("id, job_number, status, total_etb, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
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
      {staff && (
        <p className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <span>This is also a staff account.</span>
          <Link href="/admin" className="font-medium text-primary underline">Open the admin dashboard →</Link>
        </p>
      )}
      {sp.welcome && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">{t("account.welcome")}</p>}
      {sp.passwordChanged && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success" role="status">{t("account.passwordChanged")}</p>}

      <div className="space-y-6">
        {!!offers?.length && (
          <Card className="border-accent/50 bg-accent/5">
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
          <CardHeader><CardTitle>{t("account.myOrders")}</CardTitle></CardHeader>
          <CardContent>
            {!orders?.length ? (
              <p className="text-sm text-muted-foreground">{t("account.noOrders")} <Link href="/shop" className="text-primary underline">{t("nav.shop")}</Link></p>
            ) : (
              <ul className="divide-y">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/order-success/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-muted/40">
                      <span>
                        <span className="block font-medium">{o.order_number}</span>
                        <span className="block text-xs text-muted-foreground">{formatDateTime(o.created_at, locale)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm tabular-nums">{formatETB(toSantim(o.total_etb), locale)}</span>
                        <StatusBadge kind="order" status={o.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {!!jobs?.length && (
          <Card>
            <CardHeader><CardTitle>{t("account.myPrintJobs")}</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/printing/jobs/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-muted/40">
                      <span>
                        <span className="block font-medium">{j.job_number}</span>
                        <span className="block text-xs text-muted-foreground">{formatDateTime(j.created_at, locale)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {j.total_etb !== null && <span className="text-sm tabular-nums">{formatETB(toSantim(j.total_etb), locale)}</span>}
                        <StatusBadge kind="print" status={j.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>{t("account.profile")}</CardTitle></CardHeader>
          <CardContent>
            <ProfileForm fullName={account?.full_name ?? ""} phone={account?.phone ? formatEthiopianPhone(account.phone) : ""} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
