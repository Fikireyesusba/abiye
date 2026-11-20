import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2, Clock, FileText, XCircle } from "lucide-react";
import { AddPrintingToCart } from "@/components/shop/add-printing-to-cart";
import { CopyButton } from "@/components/shop/copy-button";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { isAccessToken, isGuid } from "@/lib/orders/access";
import { getCustomerUser } from "@/lib/account/session";
import { OtherAccountNotice } from "@/components/account/other-account";
import { getJobForCustomer, readJobAccess } from "@/lib/printing/access";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PrintJobPage({ params, searchParams }: PageProps<"/printing/jobs/[jobId]">) {
  const { jobId } = await params;
  const q = (await searchParams).t;
  const [t, locale] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>]);
  const cookieToken = await readJobAccess(jobId);
  const queryToken = typeof q === "string" && isAccessToken(q) ? q : null;
  let token: string | null = cookieToken;
  let job = token ? await getJobForCustomer(jobId, token) : null;
  if (!job && queryToken) {
    token = queryToken;
    job = await getJobForCustomer(jobId, queryToken);
  }
  let signedInAs: string | null = null;
  if (!job) {
    // The signed-in owner can open their job from any device.
    const user = await getCustomerUser();
    signedInAs = user?.email ?? null;
    // Email links may open in a signed-out browser: sign in, then come back here.
    if (!user && isGuid(jobId)) redirect(`/account/login?next=${encodeURIComponent(`/printing/jobs/${jobId}`)}`);
    job = user ? await getJobForCustomer(jobId, null, user.id) : null;
    token = null;
  }
  if (!job && signedInAs && isGuid(jobId)) return <OtherAccountNotice email={signedInAs} next={`/printing/jobs/${jobId}`} />;
  if (!job) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
        <XCircle className="size-10 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">{t("printJob.notFound")}</p>
        <Button asChild variant="outline"><Link href="/printing">{t("nav.printing")}</Link></Button>
      </div>
    );
  }

  const etb = (n: number) => formatETB(toSantim(n), locale);
  const payable = job.status === "awaiting_payment" && !job.order_id && job.total_etb !== null;
  const appUrl = process.env.APP_URL ?? "";
  const link = token ? `${appUrl}/printing/jobs/${job.id}?t=${token}` : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("printJob.title", { number: job.job_number })}</h1>
        <StatusBadge kind="print" status={job.status} />
      </header>

      <div className="grid items-start gap-6 md:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          {job.status === "awaiting_quote" && (
            <div className="flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4" role="status">
              <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div><p className="font-semibold">{t("printJob.awaitingQuoteTitle")}</p>
                <p className="text-sm">{t("printJob.awaitingQuoteText", { phone: formatEthiopianPhone(job.customer_phone) })}</p></div>
            </div>
          )}
          {job.status === "ready" && (
            <div className="flex gap-3 rounded-xl border border-success/30 bg-success/8 p-4 text-success" role="status">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p className="font-semibold">{t("printJob.readyText", { where: t(job.fulfillment_method === "pickup" ? "printJob.pickupWhere" : "printJob.deliveryWhere") })}</p>
            </div>
          )}

          {job.total_etb !== null && (
            <Card>
              <CardHeader><CardTitle>{t("printJob.priceTitle")}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <dl className="space-y-1 text-sm">
                  {job.price_per_page_etb !== null && job.page_count !== null ? (
                    <div className="text-muted-foreground">{t("printJob.breakdown", { pages: job.page_count, copies: job.copies, price: etb(job.price_per_page_etb) })}</div>
                  ) : (
                    <div className="text-muted-foreground">{t("printJob.pricedByTeam")}</div>
                  )}
                  {job.service_charge_etb > 0 && job.price_per_page_etb !== null && (
                    <div className="flex justify-between"><dt className="text-muted-foreground">{t("printJob.serviceCharge")}</dt><dd>{etb(job.service_charge_etb)}</dd></div>
                  )}
                  <div className="flex justify-between border-t pt-2 text-lg font-semibold"><dt>{t("printJob.total")}</dt><dd className="tabular-nums">{etb(job.total_etb)}</dd></div>
                </dl>
                {payable && <AddPrintingToCart jobId={job.id} accessToken={token} />}
                {job.order && (
                  <p className="text-sm">
                    {t("printJob.inOrder", { number: job.order.order_number })} ·{" "}
                    <Link href={`/order-success/${job.order_id}`} className="text-primary underline">{t("printJob.viewOrder")}</Link>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>{t("printJob.history")}</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l pl-4 text-sm">
                {job.history.map((h, i) => (
                  <li key={i} className="relative">
                    <span className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full bg-printing" aria-hidden />
                    <span className="font-medium">{t(`printStatus.${h.to_status}`)}</span>{" "}
                    <span className="text-muted-foreground">· {formatDateTime(h.created_at, locale)}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {appUrl && link && (
            <Card>
              <CardContent className="space-y-1">
                <p className="text-sm font-medium">{t("printJob.privateLink")}</p>
                <div className="flex items-center gap-3">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1.5 text-xs">{link}</code>
                  <CopyButton value={link} label={t("printJob.privateLink")} />
                </div>
                <p className="text-xs text-muted-foreground">{t("printJob.privateLinkHint")}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>{t("printJob.options")}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="space-y-1">
              <div>{t(`printing.${job.color_mode}`)} · {job.paper_size} · {t(`printing.${job.sides}`)}</div>
              <div>{t("printJob.copiesN", { count: job.copies })}{job.page_count ? ` · ${t("printJob.pagesN", { count: job.page_count })}` : ""}</div>
              <div>{t(`fulfillment.${job.fulfillment_method}`)}</div>
            </dl>
            <div>
              <p className="mb-1 font-medium">{t("printJob.files")}</p>
              <ul className="space-y-1">
                {job.files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.original_name}</span>
                    <span className="text-xs text-muted-foreground">{f.deleted_at ? t("printJob.fileDeleted") : f.page_count ?? "?"}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              {job.files.length > 0 && job.files.every((f) => f.deleted_at) ? t("printJob.retentionDone") : t("printJob.retention", { date: formatDateTime(job.files_delete_after, locale) })}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
