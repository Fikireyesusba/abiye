"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTicket, replyTicket, type ReplyState, type TicketState } from "@/lib/support/actions";
import { ORDER_OPTIONAL, ORDER_REQUIRED, TICKET_TOPICS, type TicketTopic } from "@/lib/support/topics";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/** New support ticket: topic first, then the fields that topic needs (order number, title), then details. */
export function SupportForm({ orders }: { orders: string[] }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<TicketState, FormData>(createTicket, {});
  const [topic, setTopic] = useState<TicketTopic | "">("");
  const needsOrder = topic !== "" && ORDER_REQUIRED.includes(topic);
  const mayOrder = topic !== "" && ORDER_OPTIONAL.includes(topic);
  const err = (f: TicketState["field"]) => state.field === f && state.error;

  if (state.ticketId) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-5" role="status">
        <p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="size-5" aria-hidden /> {t("support.sent", { number: state.ticketNumber ?? "" })}</p>
        <Button asChild variant="outline"><Link href={`/support/${state.ticketId}`}>{t("support.ticket", { number: state.ticketNumber ?? "" })}</Link></Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-5" data-testid="support-form">
      <div className="space-y-2">
        <Label htmlFor="topic">{t("support.topic")}</Label>
        <select id="topic" name="topic" required value={topic} onChange={(e) => setTopic(e.target.value as TicketTopic)} className={selectClass}>
          <option value="" disabled>{t("support.chooseTopic")}</option>
          {TICKET_TOPICS.map((k) => <option key={k} value={k}>{t(`support.topics.${k}`)}</option>)}
        </select>
      </div>
      {(needsOrder || mayOrder) && (
        <div className="space-y-2">
          <Label htmlFor="orderNumber">{needsOrder ? t("support.orderNumber") : t("support.orderOptional")}</Label>
          <Input id="orderNumber" name="orderNumber" list="my-orders" required={needsOrder} maxLength={12} autoComplete="off" autoCapitalize="characters" placeholder="ET-10025" />
          <datalist id="my-orders">{orders.map((n) => <option key={n} value={n} />)}</datalist>
          <p className="text-xs text-muted-foreground">{t("support.orderNumberHint")}</p>
          {err("orderNumber") && <p className="text-sm text-destructive" role="alert">{t("track.notFound")}</p>}
        </div>
      )}
      {topic === "other" && (
        <div className="space-y-2">
          <Label htmlFor="subject">{t("support.subject")}</Label>
          <Input id="subject" name="subject" required minLength={3} maxLength={120} placeholder={t("support.subjectHint")} />
          {err("subject") && <p className="text-sm text-destructive" role="alert">{t("support.subjectHint")}</p>}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="details">{t("support.details")}</Label>
        <Textarea id="details" name="details" required minLength={10} maxLength={3000} rows={6} placeholder={t("support.detailsHint")} />
        {err("details") && <p className="text-sm text-destructive" role="alert">{t("support.detailsHint")}</p>}
      </div>
      {state.error && !state.field && <p className="text-sm text-destructive" role="alert">{t(`errors.${state.error}`)}</p>}
      <Button type="submit" disabled={pending || !topic}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />} {pending ? t("support.sending") : t("support.send")}
      </Button>
    </form>
  );
}

export function SupportReplyForm({ ticketId }: { ticketId: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<ReplyState, FormData>(replyTicket, {});
  return (
    <form action={action} key={state.ok ? state.submitted : "reply"} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <Label htmlFor="body">{t("support.reply")}</Label>
      <Textarea id="body" name="body" required maxLength={3000} rows={3} />
      {state.error && <p className="text-sm text-destructive" role="alert">{t(`errors.${state.error}`)}</p>}
      {state.ok && <p className="text-sm text-success" role="status">{t("support.replySent")}</p>}
      <Button type="submit" disabled={pending} size="sm">{pending ? <Loader2 className="animate-spin" /> : <Send />} {t("support.sendReply")}</Button>
    </form>
  );
}
