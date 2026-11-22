import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SupportForm } from "@/components/shop/support-form";
import { requireCustomer } from "@/lib/account/session";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("support");
  return { title: t("title"), robots: { index: false } };
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "outline"> = {
  open: "default", in_progress: "secondary", waiting_customer: "warning", resolved: "success", closed: "outline",
};

/** Support & feedback: signed-in customers report an issue (a ticket) and follow their tickets. */
export default async function SupportPage() {
  const user = await requireCustomer("/support");
  const [t, locale] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>]);
  // RLS: only this customer's own tickets and orders.
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("close_stale_tickets"); // waiting 48 h for an answer → closed
  const [{ data: tickets }, { data: orders }] = await Promise.all([
    supabase.from("support_tickets").select("id, ticket_number, subject, status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("orders").select("order_number").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t("support.title")}</h1>
      <p className="mb-6 text-muted-foreground">{t("support.intro")}</p>
      <h2 className="mb-3 text-lg font-semibold">{t("support.newTicket")}</h2>
      <SupportForm orders={(orders ?? []).map((o) => o.order_number)} />
      <h2 className="mt-10 mb-3 text-lg font-semibold">{t("support.myTickets")}</h2>
      {(tickets ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("support.none")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="my-tickets">
          {(tickets ?? []).map((k) => (
            <li key={k.id}>
              <Link href={`/support/${k.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{k.ticket_number} · {k.subject}</span>
                  <span className="block text-xs text-muted-foreground">{t("support.created", { date: formatDateTime(k.created_at, locale) })}</span>
                </span>
                <Badge variant={STATUS_VARIANT[k.status] ?? "secondary"}>{t(`support.status.${k.status}`)}</Badge>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
