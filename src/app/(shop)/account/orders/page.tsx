import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/status/status-badge";
import { requireCustomer } from "@/lib/account/session";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { rateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("myOrders"), robots: { index: false } };
}

/** My orders: one line per order (tap to open it). Unpaid orders that expired or were cancelled are not listed. */
export default async function MyOrdersPage() {
  const user = await requireCustomer("/account/orders");
  const [t, locale] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>]);
  // Unpaid orders past their payment time are closed first (releases their stock). Rate limited per customer.
  if (await rateLimit(`orders:expire:${user.id}`, 30, 3600)) await getSupabaseAdmin().rpc("expire_unpaid_orders").then(() => null, () => null);
  // RLS: a customer can only read their own orders and printing jobs.
  const supabase = await createSupabaseServerClient();
  const [{ data: orders }, { data: jobs }] = await Promise.all([
    supabase.from("orders").select("id, order_number, status, payment_status, total_etb, created_at").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("printing_jobs").select("id, job_number, status, total_etb, created_at, order_id").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(100),
  ]);
  // An order that was never paid and is closed (expired / cancelled) is not an order: leave it out.
  const list = (orders ?? []).filter((o) => !(["expired", "cancelled"].includes(o.status) && ["unpaid", "rejected"].includes(o.payment_status)));
  const printJobs = (jobs ?? []).filter((j) => j.status !== "cancelled" || j.order_id);
  const Row = ({ href, number, at, total, badge }: { href: string; number: string; at: string; total: number | null; badge: React.ReactNode }) => (
    <li>
      <Link href={href} className="flex items-center gap-3 py-3 hover:bg-muted/40">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{number}</span>
          <span className="block text-xs text-muted-foreground">{formatDateTime(at, locale)}</span>
        </span>
        {total !== null && <span className="text-sm tabular-nums">{formatETB(toSantim(total), locale)}</span>}
        {badge}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/account" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t("account.title")}</Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("account.myOrders")}</h1>
      <section className="mb-8">
        {!list.length ? (
          <p className="text-sm text-muted-foreground">{t("account.noOrders")} <Link href="/shop" className="text-primary underline">{t("nav.shop")}</Link></p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card px-4" data-testid="my-orders">
            {list.map((o) => <Row key={o.id} href={`/order-success/${o.id}`} number={o.order_number} at={o.created_at} total={o.total_etb} badge={<StatusBadge kind="order" status={o.status} />} />)}
          </ul>
        )}
      </section>
      {printJobs.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("account.myPrintJobs")}</h2>
          <ul className="divide-y rounded-xl border bg-card px-4">
            {printJobs.map((j) => <Row key={j.id} href={`/printing/jobs/${j.id}`} number={j.job_number} at={j.created_at} total={j.total_etb} badge={<StatusBadge kind="print" status={j.status} />} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
