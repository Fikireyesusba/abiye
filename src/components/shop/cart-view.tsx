"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Printer, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cart, itemKey } from "@/lib/cart/store";
import { useCartDetails } from "@/lib/cart/use-cart-details";
import { formatETB, toSantim } from "@/lib/money";
import { computeCartTotals } from "@/lib/pricing/cart";
import { localized, type Locale } from "@/i18n/config";
import { QuantityStepper } from "./add-to-cart";
import { Price } from "./price";
import { ProductImage } from "./product-image";

export function CartView() {
  const { items, productItems, details, error, removed } = useCartDetails();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const lines = useMemo(() => {
    if (!details) return [];
    const byId = new Map(details.products.map((p) => [p.id, p]));
    return productItems.map((item) => {
      const product = byId.get(item.productId) ?? null;
      const unavailable = !product || (product.available !== null && product.available <= 0);
      const short = !!product && product.available !== null && product.available > 0 && product.available < item.quantity;
      return { item, product, unavailable, short };
    });
  }, [productItems, details]);

  const printLines = useMemo(() => {
    if (!details) return [];
    const byId = new Map(details.printing.map((j) => [j.id, j]));
    return items.filter((i) => i.type === "printing").map((i) => ({ id: i.printingJobId, job: byId.get(i.printingJobId) ?? null }));
  }, [items, details]);

  const removedNotice = removed.length > 0 && (
    <p role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="soldout-removed">
      <AlertTriangle className="size-4 shrink-0" aria-hidden /> {t("cartPage.soldOutRemoved", { items: removed.filter(Boolean).join(", ") || "—" })}
    </p>
  );

  if (items.length === 0) {
    return (
      <>
      {removedNotice}
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-20 text-center">
        <ShoppingBag className="size-12 text-muted-foreground" aria-hidden />
        <p className="text-lg">{t("cart.empty")}</p>
        <Button asChild>
          <Link href="/shop">{t("cartPage.continueShopping")}</Link>
        </Button>
      </div>
      </>
    );
  }

  if (error) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">{t("errors.unexpected")}</p>;
  }

  if (!details) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          {items.map((i) => (
            <Skeleton key={itemKey(i)} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  // Delivery or pickup (and the city) are chosen once, at checkout. The basket shows the items only.
  const valid = lines.filter((l) => !l.unavailable && l.product);
  const payablePrint = printLines.filter((l) => l.job?.payable);
  const totals = computeCartTotals(
    [
      ...valid.map((l) => ({ unitPrice: toSantim(l.product!.unit_price_etb), quantity: l.item.quantity })),
      ...payablePrint.map((l) => ({ unitPrice: toSantim(l.job!.total_etb!), quantity: 1 })),
    ],
    { fulfillment: "pickup", zoneFee: null, freeDeliveryThreshold: null },
  );
  const anythingToPay = valid.length > 0 || payablePrint.length > 0;
  const hasIssues = lines.some((l) => l.unavailable || l.short) || printLines.some((l) => !l.job?.payable);

  return (
    <>
    {removedNotice}
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <ul className="divide-y rounded-xl border bg-card">
        {lines.map(({ item, product, unavailable, short }) => {
          const name = product ? localized(product, "name", locale) : "—";
          const max = product?.available ?? 100;
          return (
            <li key={item.productId} className="flex gap-3 p-3 sm:gap-4 sm:p-4">
              <div className="w-20 shrink-0 self-start overflow-hidden rounded-lg border sm:w-24">
                <ProductImage src={product?.imageUrl ?? null} alt={name} department={product?.department ?? "cosmetics"} sizes="96px" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  {product ? (
                    <Link href={`/products/${product.slug}`} className="line-clamp-2 font-medium hover:text-primary">
                      {name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("cartPage.unavailable")}</span>
                  )}
                  <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-8 shrink-0" onClick={() => cart.remove(item.productId)} aria-label={`${t("cart.remove")} ${name}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {product && <Price price={product.price_etb} salePrice={product.sale_price_etb} locale={locale} size="sm" />}
                {unavailable && product && (
                  <p className="flex items-center gap-1.5 text-sm text-destructive">
                    <AlertTriangle className="size-4" aria-hidden /> {t("cartPage.unavailable")}
                  </p>
                )}
                {short && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-amber-700">
                    <AlertTriangle className="size-4" aria-hidden /> {t("cartPage.adjusted", { count: product!.available! })}
                    <Button size="sm" variant="outline" className="h-7" onClick={() => cart.setQuantity(item.productId, product!.available!)}>
                      {t("cartPage.setQuantity", { count: product!.available! })}
                    </Button>
                  </div>
                )}
                {product && !unavailable && (
                  <div className="flex items-center justify-between gap-2">
                    <QuantityStepper size="sm" value={item.quantity} max={Math.max(item.quantity, Math.min(100, max))} onChange={(n) => cart.setQuantity(item.productId, n)} />
                    <span className="text-sm font-semibold tabular-nums">
                      {formatETB(toSantim(product.unit_price_etb * item.quantity), locale)}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {printLines.map(({ id, job }) => (
          <li key={id} className="flex gap-3 p-3 sm:gap-4 sm:p-4">
            <div className="flex w-20 shrink-0 items-center justify-center self-start rounded-lg border bg-printing/10 text-printing sm:w-24 aspect-square">
              <Printer className="size-7" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                {job ? (
                  <Link href={`/printing/jobs/${id}`} className="font-medium hover:text-primary">{t("printJob.title", { number: job.job_number })}</Link>
                ) : (
                  <span className="text-muted-foreground">{t("cartPage.unavailable")}</span>
                )}
                <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-8 shrink-0" onClick={() => cart.remove(id)} aria-label={t("cart.remove")}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {job && (
                <p className="text-sm text-muted-foreground">
                  {t(`printing.${job.summary.color_mode}`)} · {job.summary.paper_size} · {t(`printing.${job.summary.sides}`)} · {t("printJob.copiesN", { count: job.summary.copies })}
                  {job.summary.page_count ? ` · ${t("printJob.pagesN", { count: job.summary.page_count })}` : ""}
                </p>
              )}
              {job?.payable ? (
                <span className="text-sm font-semibold tabular-nums">{formatETB(toSantim(job.total_etb!), locale)}</span>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" aria-hidden /> {t("printJob.notPayable")}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Card className="lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>{t("cartPage.summary")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("cartPage.deliveryAtCheckout")}</p>
          {details.deliveryEnabled && (details.deliveryDiscounts ?? []).length > 0 && (
            <p className="text-xs text-success" data-testid="delivery-discount-steps">
              {[...details.deliveryDiscounts].sort((a, b) => a.min_amount_etb - b.min_amount_etb)
                .map((d) => t("cartPage.deliveryStep", { amount: formatETB(toSantim(d.min_amount_etb), locale), percent: d.percent })).join(" · ")}
            </p>
          )}
          {details.deliveryEnabled && details.freeDeliveryThresholdEtb !== null && (
            <p className="text-xs text-success">{t("cartPage.freeOver", { amount: formatETB(toSantim(details.freeDeliveryThresholdEtb), locale) })}</p>
          )}
          <Separator />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("cart.subtotal")}</dt>
              <dd className="tabular-nums">{formatETB(totals.subtotal, locale)}</dd>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <dt>{t("cartPage.itemsTotal")}</dt>
              <dd className="tabular-nums">{formatETB(totals.total, locale)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{t("cartPage.calculatedAtCheckout")}</p>
          {hasIssues && <p className="text-sm text-destructive">{t("cartPage.fixIssues")}</p>}
          {hasIssues || !anythingToPay ? (
            <Button size="lg" className="w-full" disabled>
              {t("cart.checkout")}
            </Button>
          ) : (
            <Button size="lg" className="w-full" asChild>
              <Link href="/checkout">{t("cart.checkout")}</Link>
            </Button>
          )}
          <Button variant="link" className="w-full" asChild>
            <Link href="/shop">{t("cartPage.continueShopping")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
