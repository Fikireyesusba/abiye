"use client";
import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { rateTicket, type RateState } from "@/lib/support/actions";
import { cn } from "@/lib/utils";

/** 1–5 stars + optional comment. */
export function RateTicketForm({ ticketId, onDone }: { ticketId: string; onDone?: () => void }) {
  const t = useTranslations("support");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState<RateState, FormData>(rateTicket, {});
  const [stars, setStars] = useState(0);
  useEffect(() => { if (state.ok && onDone) { const id = setTimeout(onDone, 1500); return () => clearTimeout(id); } }, [state.ok, onDone]);
  if (state.ok) return <p className="text-sm font-medium text-success" role="status">{t("rateThanks")}</p>;
  return (
    <form action={action} className="space-y-3" data-testid="rate-form">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="rating" value={stars || ""} />
      <div className="flex gap-1" role="radiogroup" aria-label={t("rateTitle")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t("rateStars", { count: n })} onClick={() => setStars(n)}
            className="rounded p-1 focus-visible:outline-2 focus-visible:outline-primary" data-testid={`star-${n}`}>
            <Star className={cn("size-8", n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} aria-hidden />
          </button>
        ))}
      </div>
      <Textarea name="comment" maxLength={500} rows={2} placeholder={t("rateComment")} />
      {state.error && <p className="text-sm text-destructive" role="alert">{te(state.error)}</p>}
      <Button type="submit" size="sm" disabled={pending || !stars}>{pending && <Loader2 className="animate-spin" />} {t("rateSend")}</Button>
    </form>
  );
}

/** Pop-up after a ticket was resolved / closed (until rated or dismissed on this device). */
export function RatePrompt({ ticket }: { ticket: { id: string; number: string } | null }) {
  const t = useTranslations("support");
  const key = ticket ? `rate-dismissed:${ticket.id}` : "";
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ticket) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(key) === "1"; } catch { /* ignore */ }
    if (!dismissed) { const id = setTimeout(() => setOpen(true), 800); return () => clearTimeout(id); }
  }, [ticket, key]);
  if (!ticket || !open) return null;
  const close = () => {
    try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="rate-title" data-testid="rate-prompt">
      <div className="relative w-full max-w-sm space-y-3 rounded-xl border bg-card p-5 shadow-xl">
        <button type="button" onClick={close} className="absolute top-3 right-3 rounded p-1 text-muted-foreground hover:bg-muted" aria-label={t("rateClose")} data-testid="rate-close">
          <X className="size-5" aria-hidden />
        </button>
        <h2 id="rate-title" className="pr-8 font-semibold">{t("rateTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("rateText", { number: ticket.number })}</p>
        <RateTicketForm ticketId={ticket.id} onDone={close} />
      </div>
    </div>
  );
}
