"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cart, readFulfillmentPrefs, saveFulfillmentPrefs, type FulfillmentPrefs } from "@/lib/cart/store";
import { useCartDetails } from "@/lib/cart/use-cart-details";
import type { AppErrorCode } from "@/lib/errors";
import { formatETB, toSantim } from "@/lib/money";
import { placeOrder } from "@/lib/orders/checkout-action";
import { computeCartTotals } from "@/lib/pricing/cart";
import { localized, type Locale } from "@/i18n/config";

const IDEM_KEY = "checkout:idempotency:v1";

/** One key per checkout attempt; reused on retries so a double-submit never creates two orders. */
function idempotencyKey(): string {
  try {
    const existing = sessionStorage.getItem(IDEM_KEY);
    if (existing) return existing;
    const k = crypto.randomUUID();
    sessionStorage.setItem(IDEM_KEY, k);
    return k;
  } catch {
    return crypto.randomUUID();
  }
}

type FieldErrors = Partial<Record<"fullName" | "phone" | "deliveryZoneId" | "addressLine" | "instructions", AppErrorCode>>;

export function CheckoutForm({ shopAddress }: { shopAddress: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { items, productItems, details, error: loadError, refresh } = useCartDetails();
  const [prefs, setPrefs] = useState<FulfillmentPrefs>(() => readFulfillmentPrefs());
  const [form, setForm] = useState({ fullName: "", phone: "", addressLine: "", instructions: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<AppErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const view = useMemo(() => {
    if (!details) return null;
    const byId = new Map(details.products.map((p) => [p.id, p]));
    const lines = productItems.map((item) => ({ item, product: byId.get(item.productId) ?? null }));
    const jobs = new Map(details.printing.map((j) => [j.id, j]));
    const printLines = items.filter((i) => i.type === "printing").map((i) => jobs.get(i.printingJobId) ?? null);
    const problem =
      lines.some(({ item, product }) => !product || (product.available !== null && product.available < item.quantity)) ||
      printLines.some((j) => !j?.payable);
    const method: "delivery" | "pickup" =
      prefs.method === "pickup" && details.pickupEnabled ? "pickup" : details.deliveryEnabled ? "delivery" : "pickup";
    const zone = details.zones.find((z) => z.id === prefs.deliveryZoneId) ?? null;
    const totals = computeCartTotals(
      [
        ...lines.filter((l) => l.product).map((l) => ({ unitPrice: toSantim(l.product!.unit_price_etb), quantity: l.item.quantity })),
        ...printLines.filter((j) => j?.payable).map((j) => ({ unitPrice: toSantim(j!.total_etb!), quantity: 1 })),
      ],
      {
        fulfillment: method,
        zoneFee: zone ? toSantim(zone.fee_etb) : null,
        freeDeliveryThreshold: details.freeDeliveryThresholdEtb !== null ? toSantim(details.freeDeliveryThresholdEtb) : null,
      },
    );
    return { lines, printLines, problem, method, zone, totals };
  }, [details, items, productItems, prefs]);

  const updatePrefs = (p: FulfillmentPrefs) => {
    setPrefs(p);
    saveFulfillmentPrefs(p);
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldError = (k: keyof FieldErrors) =>
    fieldErrors[k] ? (
      <p id={`${k}-error`} className="text-sm text-destructive">
        {t(`errors.${fieldErrors[k]}`)}
      </p>
    ) : null;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
        <p>{t("checkoutPage.empty")}</p>
        <Button asChild>
          <Link href="/shop">{t("cartPage.continueShopping")}</Link>
        </Button>
      </div>
    );
  }
  if (!view || !details) {
    return loadError ? (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">{t("errors.unexpected")}</p>
    ) : (
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Skeleton className="h-96" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await placeOrder({
        idempotencyKey: idempotencyKey(),
        locale,
        fullName: form.fullName,
        phone: form.phone,
        fulfillment: view.method,
        deliveryZoneId: view.method === "delivery" ? (view.zone?.id ?? undefined) : undefined,
        addressLine: view.method === "delivery" ? form.addressLine || undefined : undefined,
        instructions: form.instructions || undefined,
        items: items.map((i) =>
          i.type === "product"
            ? { type: "product" as const, productId: i.productId, quantity: i.quantity }
            : { type: "printing" as const, printingJobId: i.printingJobId, accessToken: i.accessToken },
        ),
      }).catch(() => ({ ok: false as const, error: "unexpected" as AppErrorCode }));

      if (result.ok) {
        cart.clear();
        try {
          sessionStorage.removeItem(IDEM_KEY);
        } catch {}
        router.replace(`/order-success/${result.orderId}`);
        return;
      }
      if (result.error === "idempotency_conflict") {
        try {
          sessionStorage.removeItem(IDEM_KEY);
        } catch {}
      }
      if ("fieldErrors" in result && result.fieldErrors && Object.keys(result.fieldErrors).length) {
        setFieldErrors(result.fieldErrors);
      }
      setError(result.error);
      if (["out_of_stock", "product_unavailable", "printing_job_not_payable", "printing_job_not_found"].includes(result.error)) refresh();
    });
  };

  const stockError =
    error === "out_of_stock" || error === "product_unavailable" || error === "printing_job_not_payable" || error === "printing_job_not_found" || view.problem;

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("checkoutPage.contact")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="fullName">{t("checkout.fullName")}</Label>
              <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} value={form.fullName} onChange={set("fullName")}
                aria-invalid={!!fieldErrors.fullName} aria-describedby={fieldErrors.fullName ? "fullName-error" : undefined} />
              {fieldError("fullName")}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="phone">{t("checkout.phone")}</Label>
              <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20}
                placeholder={t("checkout.phoneHint")} value={form.phone} onChange={set("phone")}
                aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? "phone-error" : undefined} />
              {fieldError("phone")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("checkoutPage.delivery")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">{t("checkout.fulfillment")}</legend>
              {details.deliveryEnabled && (
                <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="method" className="accent-[var(--primary)]" checked={view.method === "delivery"}
                    onChange={() => updatePrefs({ ...prefs, method: "delivery" })} />
                  {t("checkout.delivery")}
                </label>
              )}
              {details.pickupEnabled && (
                <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="method" className="accent-[var(--primary)]" checked={view.method === "pickup"}
                    onChange={() => updatePrefs({ ...prefs, method: "pickup" })} />
                  {t("checkout.pickup")}
                </label>
              )}
            </fieldset>

            {view.method === "delivery" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="zone">{t("checkoutPage.deliveryCity")}</Label>
                  <select id="zone" value={view.zone?.id ?? ""} onChange={(e) => updatePrefs({ ...prefs, deliveryZoneId: e.target.value || null })}
                    aria-invalid={!!fieldErrors.deliveryZoneId}
                    className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive">
                    <option value="">{t("checkoutPage.chooseCity")}</option>
                    {details.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {localized(z, "name", locale)} — {formatETB(toSantim(z.fee_etb), locale)}
                      </option>
                    ))}
                  </select>
                  {fieldError("deliveryZoneId")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressLine">{t("checkout.address")}</Label>
                  <Textarea id="addressLine" name="addressLine" autoComplete="street-address" rows={2} maxLength={300}
                    placeholder={t("checkoutPage.addressHint")} value={form.addressLine} onChange={set("addressLine")}
                    aria-invalid={!!fieldErrors.addressLine} />
                  {fieldError("addressLine")}
                </div>
              </>
            ) : (
              <p className="rounded-md bg-muted p-3 text-sm">{t("checkoutPage.pickupInfo", { address: shopAddress })}</p>
            )}
            <div className="space-y-2">
              <Label htmlFor="instructions">{t("checkout.instructions")}</Label>
              <Textarea id="instructions" name="instructions" rows={2} maxLength={500} value={form.instructions} onChange={set("instructions")} />
              {fieldError("instructions")}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>{t("checkoutPage.summary")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {view.lines.map(({ item, product }) => (
              <li key={item.productId} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {product ? localized(product, "name", locale) : t("cartPage.unavailable")} <span className="text-muted-foreground">× {item.quantity}</span>
                </span>
                {product && <span className="shrink-0 tabular-nums">{formatETB(toSantim(product.unit_price_etb * item.quantity), locale)}</span>}
              </li>
            ))}
            {view.printLines.map((j, i) => (
              <li key={j?.id ?? i} className="flex justify-between gap-3">
                <span className="min-w-0">{j ? t("printJob.title", { number: j.job_number }) : t("cartPage.unavailable")}</span>
                {j?.payable && <span className="shrink-0 tabular-nums">{formatETB(toSantim(j.total_etb!), locale)}</span>}
              </li>
            ))}
          </ul>
          <Separator />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("cart.subtotal")}</dt>
              <dd className="tabular-nums">{formatETB(view.totals.subtotal, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("cart.delivery")}</dt>
              <dd className="tabular-nums">
                {view.method === "pickup" || view.totals.freeDeliveryApplied ? t("cart.freeDelivery") : view.zone ? formatETB(view.totals.deliveryFee, locale) : "—"}
              </dd>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <dt>{t("cart.total")}</dt>
              <dd className="tabular-nums">{formatETB(view.totals.total, locale)}</dd>
            </div>
          </dl>

          {stockError && (
            <p className="flex gap-2 rounded-md bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t("checkoutPage.fixCart")}{" "}
                <Link href="/cart" className="font-medium underline">{t("checkoutPage.backToCart")}</Link>
              </span>
            </p>
          )}
          {error && !stockError && (
            <p role="alert" className="flex gap-2 rounded-md bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t(`errors.${error}`)}
            </p>
          )}

          <p className="text-xs text-muted-foreground">{t("checkoutPage.nextStep")}</p>
          <Button type="submit" size="lg" className="w-full" disabled={pending || view.problem}>
            {pending ? <Loader2 className="animate-spin" /> : <Lock />}
            {pending ? t("checkoutPage.placing") : t("checkout.placeOrder")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t.rich("checkoutPage.agree", {
              terms: (chunks) => (
                <Link href="/terms" className="underline" target="_blank">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </CardContent>
      </Card>
    </form>
  );
}
