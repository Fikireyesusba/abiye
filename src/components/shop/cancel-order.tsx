"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cancelMyOrder } from "@/lib/orders/cancel-action";

/** "Cancel order" for the customer, until the payment is approved. */
export function CancelOrder({ orderId }: { orderId: string }) {
  const t = useTranslations("order");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <div className="space-y-1">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}><XCircle /> {t("cancelOrder")}</Button>
        <p className="text-xs text-muted-foreground">{t("cancelHint")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm font-medium">{t("cancelConfirm")}</p>
      <label className="block space-y-1 text-sm">
        <span>{t("cancelReason")}</span>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" disabled={pending}
          onClick={() => start(async () => {
            const res = await cancelMyOrder(orderId, reason);
            if (res.ok) { setOpen(false); router.refresh(); return; }
            setError(t(res.error === "not_allowed" ? "cancelNotAllowed" : res.error === "login_required" ? "cancelSignIn" : "cancelFailed"));
          })}>
          {pending && <Loader2 className="animate-spin" />} {t("cancelYes")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("keepOrder")}</Button>
      </div>
    </div>
  );
}
