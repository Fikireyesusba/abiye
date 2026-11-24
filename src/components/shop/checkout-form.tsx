"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Lock, Tag, X } from "lucide-react";
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
import { formatETB, santim, toSantim } from "@/lib/money";
import { placeOrder, previewPromotion, type PromoPreview } from "@/lib/orders/checkout-action";
import { computeCartTotals } from "@/lib/pricing/cart";
import { localized, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

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

export function CheckoutForm({
  shopAddress,
  email,
  defaults,
  walletBalance = 0,
  walletEnabled = false,
}: {
  shopAddress: string;
  email: string;
  defaults: { fullName: string; phone: string; address?: string; zoneId?: string | null };
  walletBalance?: number;
  /** Show "pay with my balance" (also when the balance is too low, with a Top up link). */
  walletEnabled?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { items, productItems, details, error: loadError, refresh, removed } = useCartDetails();
  // The account's saved delivery city/address prefill checkout (a choice made on this device wins).
  const [prefs, setPrefs] = useState<FulfillmentPrefs>(() => {
    const p = readFulfillmentPrefs();
    return p.deliveryZoneId || !defaults.zoneId ? p : { ...p, deliveryZoneId: defaults.zoneId };
  });
  const [form, setForm] = useState({ fullName: defaults.fullName, phone: defaults.phone, addressLine: defaults.address ?? "", instructions: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<AppErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const [promoInput, setPromoInput] = useState("");
  const [applied, setPromo] = useState<(Extract<PromoPreview, { ok: true }> & { basket: string }) | null>(null);
  const [promoError, setPromoError] = useState<{ code: AppErrorCode; detail?: string } | null>(null);
  const [promoPending, startPromo] = useTransition();
  const [payMethod, setPayMethod] = useState<"bank_transfer" | "wallet">("bank_transfer");

  const view = useMemo(() => {
    if (!details) return null;
    const byId = new Map(details.products.map((p) => [p.id, p]));
    const lines = productItems.map((item) => ({ item, product: byId.get(item.productId) ?? null }));
    const jobs = new Map(details.printing.map((j) => [j.id, j]));
    const printLines = items.filter((i) => i.type === "printing").map((i) => jobs.get(i.printingJobId) ?? null);
    const problem =
      lines.some(({ item, product }) => !product || (product.available !== null && product.available < item.quantity)) ||
      printLines.some((j) => !j?.payable);
    const partnerOk = details.partnerShops.length > 0;
    const method: "delivery" | "pickup" | "partner" =
      prefs.method === "partner" && partnerOk ? "partner"
        : prefs.method === "pickup" && details.pickupEnabled ? "pickup" : details.deliveryEnabled ? "delivery" : details.pickupEnabled || !partnerOk ? "pickup" : "partner";
    const shop = method === "partner" ? (details.partnerShops.find((s) => s.id === prefs.partnerShopId) ?? null) : null;
    // A partner shop costs the delivery price of its city (same bigger-purchase discount).
    const zone = method === "partner" ? (shop ? { id: shop.zone_id, fee_etb: shop.fee_etb } : null) : (details.zones.find((z) => z.id === prefs.deliveryZoneId) ?? null);
    const totals = computeCartTotals(
      [
        ...lines.filter((l) => l.product).map((l) => ({ unitPrice: toSantim(l.product!.unit_price_etb), quantity: l.item.quantity })),
        ...printLines.filter((j) => j?.payable).map((j) => ({ unitPrice: toSantim(j!.total_etb!), quantity: 1 })),
      ],
      {
        fulfillment: method === "partner" ? "delivery" : method,
        zoneFee: zone ? toSantim(zone.fee_etb) : null,
        freeDeliveryThreshold: details.freeDeliveryThresholdEtb !== null ? toSantim(details.freeDeliveryThresholdEtb) : null,
        deliveryDiscounts: details.deliveryDiscounts,
      },
    );
    return { lines, printLines, problem, method, zone, shop, totals };
  }, [details, items, productItems, prefs]);

  // The previewed discount depends on the basket: it is dropped after any change.
  const basketKey = JSON.stringify(items);
  const promo = applied && applied.basket === basketKey ? applied : null;

  const cartLines = () =>
    items.map((i) =>
      i.type === "product"
        ? { type: "product" as const, productId: i.productId, quantity: i.quantity }
        : { type: "printing" as const, printingJobId: i.printingJobId, accessToken: i.accessToken },
    );
  const applyPromo = () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoError(null);
    startPromo(async () => {
      const res = await previewPromotion(
        code,
        cartLines().map((l) => (l.type === "product" ? l : { type: l.type, printingJobId: l.printingJobId })),
      ).catch(() => ({ ok: false as const, error: "unexpected" as AppErrorCode }));
      if (res.ok) {
        setPromo({ ...res, basket: basketKey });
        setPromoInput("");
      } else {
        setPromo(null);
        setPromoError({ code: res.error, detail: "detail" in res ? res.detail : undefined });
      }
    });
  };

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
    if (view.method === "partner" && !view.shop) {
      setError("invalid_pickup_point");
      return;
    }
    startTransition(async () => {
      const result = await placeOrder({
        idempotencyKey: idempotencyKey(),
        locale,
        fullName: form.fullName,
        phone: form.phone,
        fulfillment: view.method === "partner" ? "pickup" : view.method,
        deliveryZoneId: view.method === "delivery" ? (view.zone?.id ?? undefined) : undefined,
        partnerShopId: view.method === "partner" ? (view.shop?.id ?? undefined) : undefined,
        addressLine: view.method === "delivery" ? form.addressLine || undefined : undefined,
        instructions: form.instructions || undefined,
        acceptTerms,
        promotionCode: promo?.code,
        paymentMethod: useWallet ? "wallet" : "bank_transfer",
        items: cartLines(),
      }).catch(() => ({ ok: false as const, error: "unexpected" as AppErrorCode }));

      if (result.ok) {
        cart.clear();
        try {
          sessionStorage.removeItem(IDEM_KEY);
        } catch {}
        router.replace(`/order-success/${result.orderId}`);
        return;
      }
      if (result.error === "login_required") {
        router.push("/account/login?next=/checkout");
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
      if (result.error.startsWith("promo_") || result.error === "invalid_promo_code") {
        setPromo(null);
        setPromoError({ code: result.error, detail: "detail" in result ? result.detail : undefined });
      } else setError(result.error);
      if (["out_of_stock", "product_unavailable", "printing_job_not_payable", "printing_job_not_found"].includes(result.error)) refresh();
    });
  };

  const shownTotal = promo ? Math.max(100, view.totals.total - toSantim(promo.discountEtb)) : view.totals.total;
  const walletCovers = walletBalance > 0 && toSantim(walletBalance) >= shownTotal;
  const useWallet = payMethod === "wallet" && walletCovers;

  const stockError =
    error === "out_of_stock" || error === "product_unavailable" || error === "printing_job_not_payable" || error === "printing_job_not_found" || view.problem;

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="min-w-0 space-y-6">
        {removed.length > 0 && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="soldout-removed">
            <AlertTriangle className="size-4 shrink-0" aria-hidden /> {t("cartPage.soldOutRemoved", { items: removed.filter(Boolean).join(", ") || "—" })}
          </p>
        )}
        <Card>
          <CardHeader>
            <CardTitle>{t("checkoutPage.contact")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("account.orderAs", { email })}</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="fullName">{t("checkout.fullName")}</Label>
              <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} value={form.fullName} onChange={set("fullName")}
                readOnly={!!defaults.fullName} className={defaults.fullName ? "bg-muted" : undefined}
                aria-invalid={!!fieldErrors.fullName} aria-describedby={fieldErrors.fullName ? "fullName-error" : undefined} />
              {fieldError("fullName")}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="phone">{t("checkout.phone")}</Label>
              <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20}
                placeholder={t("checkout.phoneHint")} value={form.phone} onChange={set("phone")}
                readOnly={!!defaults.phone} className={defaults.phone ? "bg-muted" : undefined}
                aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? "phone-error" : undefined} />
              {fieldError("phone")}
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="contact-note">
              {defaults.fullName && defaults.phone ? t("checkout.fromAccount") : t("checkout.setOnce")}
            </p>
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
              {details.partnerShops.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 sm:col-span-2">
                  <input type="radio" name="method" className="accent-[var(--primary)]" checked={view.method === "partner"}
                    onChange={() => updatePrefs({ ...prefs, method: "partner" })} />
                  {t("checkout.partnerPickup")}
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
            ) : view.method === "partner" ? (
              <div className="space-y-2">
                <Label htmlFor="partnerShop">{t("checkoutPage.partnerShop")}</Label>
                <select id="partnerShop" value={view.shop?.id ?? ""} onChange={(e) => updatePrefs({ ...prefs, method: "partner", partnerShopId: e.target.value || null })}
                  aria-invalid={error === "invalid_pickup_point"}
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive">
                  <option value="">{t("checkoutPage.choosePartner")}</option>
                  {details.partnerShops.map((s) => (
                    <option key={s.id} value={s.id}>{locale === "am" && s.city_am ? s.city_am : s.city} — {s.name} ({formatETB(toSantim(s.fee_etb), locale)})</option>
                  ))}
                </select>
                {view.shop && (
                  <div className="space-y-1 rounded-md bg-muted p-3 text-sm" data-testid="partner-shop-details">
                    <p className="font-medium">{view.shop.name} · {locale === "am" && view.shop.city_am ? view.shop.city_am : view.shop.city}</p>
                    <p>{view.shop.address_line}</p>
                    {view.shop.landmark && <p className="text-muted-foreground">{t("checkoutPage.landmark")}: {view.shop.landmark}</p>}
                    {view.shop.opening_hours && <p className="text-muted-foreground">{t("checkoutPage.openingHours")}: {view.shop.opening_hours}</p>}
                    <p><a href={`tel:${view.shop.phone}`} className="text-primary hover:underline">{view.shop.phone}</a>
                      {view.shop.map_url && <> · <a href={view.shop.map_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{t("checkoutPage.openMap")}</a></>}</p>
                    <p className="pt-1 text-xs text-muted-foreground">{t("checkoutPage.partnerInfo")}</p>
                  </div>
                )}
              </div>
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
                {view.method !== "pickup" && view.zone && view.totals.deliveryDiscountPercent > 0 && (
                  <span className="block text-xs text-success" data-testid="delivery-discount">{t("cart.deliveryDiscount", { percent: view.totals.deliveryDiscountPercent })}</span>
                )}
              </dd>
            </div>
            {promo && (
              <div className="flex justify-between text-success">
                <dt>{t("checkoutPage.discount")} ({promo.code})</dt>
                <dd className="tabular-nums">−{formatETB(santim(Math.min(toSantim(promo.discountEtb), view.totals.total - 100)), locale)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-3 text-base font-semibold">
              <dt>{t("cart.total")}</dt>
              <dd className="tabular-nums">
                {formatETB(promo ? santim(Math.max(100, view.totals.total - toSantim(promo.discountEtb))) : view.totals.total, locale)}
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            {promo ? (
              <p className="flex items-center justify-between gap-2 rounded-md bg-success/10 p-2 text-sm text-success">
                <span className="flex items-center gap-1.5"><Tag className="size-4 shrink-0" aria-hidden />
                  {t("checkoutPage.promoApplied", { title: promo.title[locale] || promo.title.en, code: promo.code })}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPromo(null)} aria-label={t("checkoutPage.promoRemove")}>
                  <X className="size-4" />
                </Button>
              </p>
            ) : (
              <div className="flex gap-2">
                <Label htmlFor="promo" className="sr-only">{t("checkoutPage.promoCode")}</Label>
                <Input id="promo" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder={t("checkoutPage.promoCode")}
                  maxLength={30} autoComplete="off" autoCapitalize="characters" className="uppercase placeholder:normal-case"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyPromo(); } }}
                  aria-invalid={!!promoError} aria-describedby={promoError ? "promo-error" : undefined} />
                <Button type="button" variant="outline" onClick={applyPromo} disabled={promoPending || !promoInput.trim()}>
                  {promoPending && <Loader2 className="animate-spin" />} {t("checkoutPage.promoApply")}
                </Button>
              </div>
            )}
            {promoError && (
              <p id="promo-error" role="alert" className="text-sm text-destructive">
                {t(`errors.${promoError.code}`)}
                {promoError.code === "promo_min_order" && promoError.detail && ` ${t("checkoutPage.promoMinOrder", { amount: formatETB(toSantim(Number(promoError.detail)), locale) })}`}
              </p>
            )}
          </div>

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

          {(walletEnabled || walletBalance > 0) && (
            <fieldset className="space-y-2" data-testid="pay-method">
              <legend className="mb-1 text-sm font-medium">{t("checkout.paymentMethod")}</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="pay" className="mt-0.5 accent-[var(--primary)]" checked={!useWallet} onChange={() => setPayMethod("bank_transfer")} />
                {t("wallet.bankTransfer")}
              </label>
              <label className={cn("flex items-start gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5", walletCovers ? "cursor-pointer" : "opacity-60")}>
                <input type="radio" name="pay" className="mt-0.5 accent-[var(--primary)]" checked={useWallet} disabled={!walletCovers} onChange={() => setPayMethod("wallet")} />
                <span>
                  <span className="block font-medium">{t("wallet.payWith")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {walletCovers ? t("wallet.payWithHint", { amount: formatETB(toSantim(walletBalance), locale) }) : t("wallet.notEnough", { amount: formatETB(toSantim(walletBalance), locale) })}
                  </span>
                  {!walletCovers && (
                    <Link href="/account/wallet/top-up" target="_blank" className="mt-1 inline-block text-xs font-medium text-primary underline" data-testid="checkout-topup">{t("wallet.topUp")}</Link>
                  )}
                </span>
              </label>
            </fieldset>
          )}
          <p className="text-xs text-muted-foreground">
            {t("checkoutPage.nextStep")}{" "}
            <Link href="/help#paying" target="_blank" className="text-primary underline">{t("help.howToPay")}</Link>
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" aria-describedby={error === "terms_required" ? "terms-error" : undefined} />
            <span>
              {t.rich("checkoutPage.acceptTerms", {
                terms: (chunks) => <Link href="/terms" className="underline" target="_blank">{chunks}</Link>,
              })}
            </span>
          </label>
          <Button type="submit" size="lg" className="w-full" disabled={pending || view.problem || !acceptTerms}>
            {pending ? <Loader2 className="animate-spin" /> : <Lock />}
            {pending ? t("checkoutPage.placing") : t("checkout.placeOrder")}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
