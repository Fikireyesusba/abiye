"use client";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { trackOrder, type TrackState } from "@/lib/orders/track-action";
import { localized, type Locale } from "@/i18n/config";

export function TrackForm() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [state, action, pending] = useActionState<TrackState, FormData>(trackOrder, {});
  const r = state.result;

  return (
    <div className="space-y-8">
      <form action={action} key={state.submitted ?? 0} className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="orderNumber">{t("track.orderNumber")}</Label>
          <Input id="orderNumber" name="orderNumber" defaultValue={state.values?.orderNumber} required maxLength={12} autoComplete="off" autoCapitalize="characters"
            placeholder={t("track.orderNumberHint")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trackingCode">{t("track.trackingCode")}</Label>
          <Input id="trackingCode" name="trackingCode" defaultValue={state.values?.trackingCode} required maxLength={12} autoComplete="off" autoCapitalize="characters"
            spellCheck={false} placeholder={t("track.trackingHint")} className="font-mono tracking-wider" />
        </div>
        <Button type="submit" disabled={pending} size="lg">
          {pending ? <Loader2 className="animate-spin" /> : <Search />}
          {pending ? t("track.searching") : t("track.submit")}
        </Button>
      </form>

      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {state.error === "order_not_found" ? t("track.notFound") : t(`errors.${state.error}`)}
        </p>
      )}

      {r && (
        <section className="space-y-5 rounded-xl border bg-card p-5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{r.order_number}</h2>
              <p className="text-sm text-muted-foreground">{t("track.placedOn", { date: formatDateTime(r.created_at, locale) })}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge kind="order" status={r.status} />
              <StatusBadge kind="payment" status={r.payment_status} />
            </div>
          </div>
          <ul className="space-y-1 text-sm">
            {r.items.map((i, idx) => (
              <li key={idx}>{localized(i, "name", locale)} <span className="text-muted-foreground">× {i.quantity}</span></li>
            ))}
          </ul>
          <p className="text-sm">
            <span className="text-muted-foreground">{t("cart.total")}: </span>
            <span className="font-semibold">{formatETB(toSantim(r.total_etb), locale)}</span>
            <span className="text-muted-foreground"> · {t(`fulfillment.${r.fulfillment_method}`)}</span>
          </p>
          <ol className="space-y-2 border-l pl-4 text-sm">
            {r.history.map((h, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full bg-primary" aria-hidden />
                <span className="font-medium">{t(`orderStatus.${h.to_status}`)}</span>{" "}
                <span className="text-muted-foreground">· {formatDateTime(h.created_at, locale)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
