import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseUpdateNeeded, PageHeader, SubTabs, Table, Td, fieldClass, isMissingDbFunction, pickTab } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime, zoneDayStartIso, zoneToday } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TICKET_LABEL, TICKET_TOPIC, TICKET_VARIANT } from "@/lib/admin/support";

export const metadata: Metadata = { title: "Support tickets" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const TABS = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting_customer", label: "Waiting for customer" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

export default async function SupportTicketsPage({ searchParams }: PageProps<"/admin/support">) {
  await requirePermission("support.view");
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 60);
  const from = DAY.test(first(sp.from) ?? "") ? first(sp.from)! : "";
  const to = DAY.test(first(sp.to) ?? "") ? first(sp.to)! : "";
  const supabase = await createSupabaseServerClient();
  const { data: all, error } = await supabase.rpc("admin_support_tickets", {
    p_search: q || undefined, p_from: from ? zoneDayStartIso(from) : undefined, p_to: to ? zoneDayStartIso(nextDay(to)) : undefined, p_limit: 1000,
  });
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Support tickets" migration="20261122000052_user_id_sessions_support.sql" />;
  const rows = all ?? [];
  const tabs = TABS.map((x) => ({ ...x, count: x.key === "all" ? undefined : rows.filter((r) => r.status === x.key).length, alert: x.key === "open" }));
  const tab = pickTab(tabs, sp.tab);
  const list = tab === "all" ? rows : rows.filter((r) => r.status === tab);
  const today = zoneToday();
  return (
    <>
      <PageHeader title="Support tickets" description="Issues and feedback sent by signed-in customers (Support & feedback). Answer them here: the customer gets an email and a phone notification." />
      <SubTabs base="/admin/support" tabs={tabs} active={tab} keep={{ q: q || undefined, from: from || undefined, to: to || undefined }} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="text-sm">Search<input name="q" defaultValue={q} placeholder="Ticket, User ID, name, email, order" maxLength={60} className={`${fieldClass} mt-1 block w-64`} /></label>
        <label className="text-sm">From<input type="date" name="from" defaultValue={from} max={today} className={`${fieldClass} mt-1 block`} /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={to} max={today} className={`${fieldClass} mt-1 block`} /></label>
        <Button type="submit" variant="outline">Show</Button>
        {(q || from || to) && <Button asChild variant="ghost"><Link href={`/admin/support?tab=${tab}`}>Clear</Link></Button>}
      </form>
      <Table scroll head={["Ticket", "Customer", "Topic", "Status", "Assigned", "Last message"]} empty="No tickets here.">
        {list.map((r) => (
          <tr key={r.id} data-row>
            <Td>
              <Link href={`/admin/support/${r.id}`} className="font-medium text-primary hover:underline">{r.ticket_number}</Link>
              <span className="block max-w-xs truncate text-xs">{r.subject}</span>
            </Td>
            <Td>
              {r.customer_name || r.email}
              <span className="block font-mono text-xs text-muted-foreground">User ID {r.member_id ?? "—"}</span>
            </Td>
            <Td className="text-xs">{TICKET_TOPIC[r.category] ?? r.category}{r.order_number && <span className="block font-mono">{r.order_number}</span>}</Td>
            <Td><Badge variant={TICKET_VARIANT[r.status] ?? "secondary"}>{TICKET_LABEL[r.status] ?? r.status}</Badge></Td>
            <Td className="text-xs">{r.assigned_name ?? "—"}</Td>
            <Td className="text-xs whitespace-nowrap">{formatDateTime(r.last_message_at, "en")}<span className="block text-muted-foreground">{r.messages} message(s)</span></Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
