import type { Metadata } from "next";
import { scanMaxMb } from "@/lib/security/virus-scan";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, Bell, CheckCircle2, Clock, Landmark, XCircle } from "lucide-react";
import { CopyButton } from "@/components/shop/copy-button";
import { CancelOrder } from "@/components/shop/cancel-order";
import { PaymentForm } from "@/components/shop/payment-form";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { redirect } from "next/navigation";
import { getCustomerUser } from "@/lib/account/session";
import { PushToggle } from "@/components/pwa/push";
import { getServerEnv } from "@/lib/env";
import { OtherAccountNotice } from "@/components/account/other-account";
import { authorizeCustomerOrder, getOrderForCustomer, isAccessToken, isGuid, readOrderAccess } from "@/lib/orders/access";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import { localized, type Locale } from "@/i18n/config";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OrderSuccessPage({ params, searchParams }: PageProps<"/order-success/[orderId]">) {
  const { orderId } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>]);

  // Access: this browser's cookie, or the private link token (?t=) from another device.
  const fromCookie = await readOrderAccess(orderId);
  const queryToken = typeof query.t === "string" && isAccessToken(query.t) ? query.t : null;
  const token = fromCookie?.token ?? queryToken;
  let order = token ? await getOrderForCustomer(orderId, token) : null;
  let accessToken: string | null = token;
  if (!order && queryToken && queryToken !== token) {
    order = await getOrderForCustomer(orderId, queryToken);
    accessToken = queryToken;
  }
  // Signed-in customers can always open their own orders (e.g. from "My account" on another device).
  let signedInAs: string | null = null;
  if (!order) {
    const user = await getCustomerUser();
    signedInAs = user?.email ?? null;
    // Links in our emails open in a browser that may not be signed in (e.g. Gmail's
    // in-app browser): ask to sign in, then come straight back to this order.
    if (!user && isGuid(orderId)) redirect(`/account/login?next=${encodeURIComponent(`/order-success/${orderId}`)}`);
    const owned = user ? await authorizeCustomerOrder(orderId, { userId: user.id }) : null;
    order = owned?.order ?? null;
    accessToken = null;
  }

  if (!order && signedInAs && isGuid(orderId)) return <OtherAccountNotice email={signedInAs} next={`/order-success/${orderId}`} />;
  if (!order) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
        <XCircle className="size-10 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">{t("order.notFound")}</p>
        <Button asChild variant="outline"><Link href="/account/orders">{t("account.myOrders")}</Link></Button>
      </div>
    );
  }

  const amount = formatETB(toSantim(order.total_etb), locale);
  // Phone notifications: offered to the signed-in customer while the order is still in progress.
  const env = getServerEnv();
  const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? env.VAPID_PUBLIC_KEY : null;
  const viewer = vapid && !["completed", "cancelled", "expired"].includes(order.status) ? await getCustomerUser() : null;
  const expired = order.status === "expired" || (["awaiting_payment", "payment_rejected"].includes(order.status) && new Date(order.payment_due_at) < new Date());
  const canPay = ["awaiting_payment", "payment_rejected"].includes(order.status) && !expired;
  const me = await getCustomerUser();
  // Only the account that placed the order can cancel it (checked again by the database).
  const viewerOwns = !!me && !!(await authorizeCustomerOrder(order.id, { userId: me.id }));
  // A rejected payment cancels the order: show why.
  const lastRejection = ["payment_rejected", "cancelled"].includes(order.status) && order.payment_status === "rejected" ? order.submissions.find((s) => s.status === "rejected") : null;
  const bank = order.bank_snapshot;
  const appUrl = process.env.APP_URL ?? "";
  const privateLink = accessToken ? `${appUrl}/order-success/${order.id}?t=${accessToken}` : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("order.title", { number: order.order_number })}</h1>
          <StatusBadge kind="order" status={expired ? "expired" : order.status} />
        </div>
        <p className="text-muted-foreground">
          {order.status === "awaiting_payment" && !expired ? t("order.placed", { name: order.customer_name }) : t("order.orderDate", { date: formatDateTime(order.created_at, locale) })}
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {/* State banners */}
          {expired && (
            <Banner tone="muted" icon={<Clock className="size-5" />} title={t("order.expiredTitle")} text={t("order.expiredText")} />
          )}
          {order.status === "cancelled" && !lastRejection && <Banner tone="muted" icon={<XCircle className="size-5" />} title={t("order.cancelledTitle")} />}
          {order.status === "pending_verification" && (
            <Banner tone="info" icon={<Clock className="size-5" />} title={t("order.pendingTitle")} text={t("order.pendingText")} />
          )}
          {lastRejection && !expired && (
            <Banner tone="danger" icon={<AlertTriangle className="size-5" />} title={t("order.rejectedTitle")}
              text={`${lastRejection.review_note ? t("order.rejectedReason", { reason: lastRejection.review_note }) + " " : ""}${t("order.rejectedHelp")}`} />
          )}
          {["confirmed", "processing", "ready_for_pickup", "out_for_delivery", "completed"].includes(order.status) && (
            <Banner tone="success" icon={<CheckCircle2 className="size-5" />} title={order.payment_method === "wallet" ? t("wallet.paidWithBalance") : t("order.confirmedTitle")} />
          )}

          {viewer && vapid && (
            <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <Bell className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <PushToggle vapidPublicKey={vapid} hint={t("push.orderHint")} className="flex-1" />
            </div>
          )}
          {canPay && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Landmark className="size-5 text-primary" aria-hidden /> {t("order.payTitle")}</CardTitle>
                <p className="text-sm font-medium text-amber-700">{t("order.payBefore", { date: formatDateTime(order.payment_due_at, locale) })}</p>
                <Link href="/help#paying" className="text-sm text-primary underline">{t("help.howToPay")}</Link>
              </CardHeader>
              <CardContent className="space-y-5">
                <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                  <li>{t("order.stepTransfer", { amount })}</li>
                  <li>{t("order.stepRemark", { number: order.order_number })}</li>
                  <li>{t("order.stepUpload")}</li>
                  <li>{t("order.stepVerify")}</li>
                </ol>
                <dl className="divide-y rounded-lg border bg-muted/40">
                  <Row label={t("checkout.amountToPay")} value={<span className="text-lg font-semibold">{amount}</span>} copy={String(order.total_etb)} />
                  <Row label={t("checkout.bankName")} value={bank.bank_name} />
                  <Row label={t("checkout.accountHolder")} value={bank.account_holder} />
                  <Row label={t("checkout.accountNumber")} value={<span className="font-mono text-lg tracking-wider">{bank.account_number}</span>} copy={bank.account_number.replace(/[\s-]/g, "")} />
                  {bank.branch && <Row label={t("checkout.branch")} value={bank.branch} />}
                </dl>
                {(locale === "am" ? bank.instructions_am : bank.instructions_en) && (
                  <p className="text-sm text-muted-foreground">{locale === "am" ? bank.instructions_am || bank.instructions_en : bank.instructions_en}</p>
                )}
                <Separator />
                <div className="space-y-3">
                  <h2 className="font-semibold">{t("order.uploadTitle")}</h2>
                  <PaymentForm orderId={order.id} accessToken={accessToken} maxMb={scanMaxMb()} />
                </div>
                <p className="text-xs text-muted-foreground">{t("checkout.verificationNote")}</p>
              </CardContent>
            </Card>
          )}

          {/* The customer may cancel until staff approve the payment. */}
          {viewerOwns && ["awaiting_payment", "pending_verification", "payment_rejected"].includes(order.status) && !expired && (
            <CancelOrder orderId={order.id} />
          )}

          {canPay && privateLink && (
            <Card>
              <CardContent className="space-y-4">
                {appUrl && privateLink && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t("order.privateLink")}</p>
                    <div className="flex items-center gap-3">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1.5 text-xs">{privateLink}</code>
                      <CopyButton value={privateLink} label={t("order.privateLink")} />
                    </div>
                    <p className="text-xs text-muted-foreground">{t("order.privateLinkHint")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>{t("order.history")}</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3 border-l pl-4">
                {order.history.map((h, i) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full bg-primary" aria-hidden />
                    <span className="font-medium">{t(`orderStatus.${h.to_status}`)}</span>{" "}
                    <span className="text-muted-foreground">· {formatDateTime(h.created_at, locale)}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 lg:sticky lg:top-24">
          <CardHeader><CardTitle>{t("order.items")}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="space-y-2">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span>
                    {localized(i, "name", locale)} <span className="text-muted-foreground">× {i.quantity}</span>
                    {order.status === "completed" && i.product?.slug && (
                      <Link href={`/products/${i.product.slug}#reviews`} className="block text-xs text-primary hover:underline">{t("reviews.write")}</Link>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatETB(toSantim(i.line_total_etb), locale)}</span>
                </li>
              ))}
            </ul>
            <Separator />
            <dl className="space-y-2">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("cart.subtotal")}</dt><dd className="tabular-nums">{formatETB(toSantim(order.subtotal_etb), locale)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("cart.delivery")}</dt><dd className="tabular-nums">{order.delivery_fee_etb > 0 ? formatETB(toSantim(order.delivery_fee_etb), locale) : t("cart.freeDelivery")}</dd></div>
              {order.discount_etb > 0 && <div className="flex justify-between text-success"><dt>{t("checkoutPage.discount")}</dt><dd className="tabular-nums">−{formatETB(toSantim(order.discount_etb), locale)}</dd></div>}
              <div className="flex justify-between text-base font-semibold"><dt>{t("cart.total")}</dt><dd className="tabular-nums">{amount}</dd></div>
            </dl>
            <Separator />
            <dl className="space-y-1">
              <dt className="text-muted-foreground">{t("order.fulfillment")}</dt>
              <dd className="font-medium">{t(`fulfillment.${order.fulfillment_method}`)}</dd>
              {order.fulfillment_method === "delivery" && (
                <>
                  <dt className="pt-2 text-muted-foreground">{t("order.deliverTo")}</dt>
                  <dd>{order.city} — {order.address_line}</dd>
                </>
              )}
              <dt className="pt-2 text-muted-foreground">{t("checkout.phone")}</dt>
              <dd>{formatEthiopianPhone(order.customer_phone)}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, copy }: { label: string; value: React.ReactNode; copy?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="[overflow-wrap:anywhere]">{value}</dd>
      </div>
      {copy && <CopyButton value={copy} label={label} />}
    </div>
  );
}

function Banner({ tone, icon, title, text }: { tone: "info" | "success" | "danger" | "muted"; icon: React.ReactNode; title: string; text?: string }) {
  const tones = {
    info: "border-info/30 bg-info/8 text-info",
    success: "border-success/30 bg-success/8 text-success",
    danger: "border-destructive/30 bg-destructive/5 text-destructive",
    muted: "border-border bg-muted text-foreground",
  };
  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${tones[tone]}`} role="status">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {text && <p className="text-sm text-foreground/80">{text}</p>}
      </div>
    </div>
  );
}
