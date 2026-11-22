import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SupportReplyForm } from "@/components/shop/support-form";
import { requireCustomer } from "@/lib/account/session";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { robots: { index: false } };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "outline"> = {
  open: "default", in_progress: "secondary", waiting_customer: "warning", resolved: "success", closed: "outline",
};

export default async function SupportTicketPage({ params }: PageProps<"/support/[id]">) {
  const { id } = await params;
  const user = await requireCustomer(`/support/${GUID.test(id) ? id : ""}`);
  if (!GUID.test(id)) notFound();
  const [t, locale] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>]);
  // RLS: the customer's own ticket, and only the messages meant for them (no internal notes).
  const supabase = await createSupabaseServerClient();
  const { data: k } = await supabase.from("support_tickets")
    .select("id, ticket_number, category, subject, details, status, order_id, order_number, created_at").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!k) notFound();
  const { data: messages } = await supabase.from("support_ticket_messages").select("id, from_staff, body, created_at").eq("ticket_id", k.id).eq("internal", false).order("id");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/support" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t("support.back")}</Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("support.ticket", { number: k.ticket_number })}</h1>
        <Badge variant={VARIANT[k.status] ?? "secondary"} data-testid="ticket-status">{t(`support.status.${k.status}`)}</Badge>
      </div>
      <div className="space-y-2 rounded-xl border bg-card p-5 text-sm">
        <p className="font-medium">{k.subject}</p>
        <p className="text-muted-foreground">{t(`support.topics.${k.category}`)}{k.order_number && <> · {t("support.orderLabel")} {k.order_id ? <Link href={`/order-success/${k.order_id}`} className="text-primary hover:underline">{k.order_number}</Link> : k.order_number}</>} · {formatDateTime(k.created_at, locale)}</p>
        <p className="whitespace-pre-wrap">{k.details}</p>
      </div>
      <h2 className="mt-8 mb-3 text-lg font-semibold">{t("support.conversation")}</h2>
      <ol className="mb-6 space-y-3" data-testid="ticket-messages">
        {(messages ?? []).map((m) => (
          <li key={m.id} className={cn("max-w-[85%] rounded-xl border p-3 text-sm", m.from_staff ? "bg-primary/5" : "ml-auto bg-card")}>
            <p className="mb-1 text-xs text-muted-foreground">{m.from_staff ? t("support.team") : t("support.you")} · {formatDateTime(m.created_at, locale)}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {k.status === "closed" ? <p className="text-sm text-muted-foreground">{t("support.closedNote")}</p> : <SupportReplyForm ticketId={k.id} />}
    </div>
  );
}
