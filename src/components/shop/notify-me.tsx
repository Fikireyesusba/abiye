"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { BellRing, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getStockAlertState, setStockAlert, type StockAlertState } from "@/lib/catalog/stock-alert-actions";

/** Out-of-stock products: "Notify me when available" (email + phone notification when restocked). */
export function NotifyMe({ productId, slug }: { productId: string; slug: string }) {
  const t = useTranslations("product");
  const [state, setState] = useState<StockAlertState | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    getStockAlertState(productId).then((s) => { if (live) setState(s); }, () => { if (live) setState({ signedIn: false, requested: false }); });
    return () => { live = false; };
  }, [productId]);

  if (!state) return <div className="h-10" aria-hidden />;
  if (!state.signedIn) {
    return (
      <Button variant="outline" asChild>
        <Link href={`/account/login?next=${encodeURIComponent(`/products/${slug}`)}`}><BellRing /> {t("notifySignIn")}</Link>
      </Button>
    );
  }
  const toggle = () =>
    start(async () => {
      const res = await setStockAlert(productId, !state.requested);
      if (!res.ok) {
        toast.error(t("notifyFailed"));
        return;
      }
      setState({ signedIn: true, requested: res.requested });
      toast.success(res.requested ? t("notifyOn") : t("notifyOff"));
    });
  return state.requested ? (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm text-success"><BellRing className="size-4" aria-hidden /> {t("notifyOn")}</p>
      <Button variant="ghost" size="sm" onClick={toggle} disabled={pending}><BellOff /> {t("notifyCancel")}</Button>
    </div>
  ) : (
    <Button onClick={toggle} disabled={pending}><BellRing /> {t("notifyMe")}</Button>
  );
}
