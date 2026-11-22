import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { UserIdLink } from "@/components/admin/user-id";
import { updateTicket } from "@/lib/admin/support-actions";
import { TICKET_LABEL, TICKET_TOPIC, TICKET_VARIANT } from "@/lib/admin/support";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Support ticket" };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SupportTicketAdminPage({ params }: PageProps<"/admin/support/[id]">) {
  const ctx = await requirePermission("support.view");
  const { id } = await params;
  if (!GUID.test(id)) notFound();
  const canManage = ctx.permissions.has("support.manage");
  const supabase = await createSupabaseServerClient();
  const { data: k } = await supabase.from("support_tickets").select("*").eq("id", id).maybeSingle();
  if (!k) notFound();
  const [{ data: messages }, { data: list }, { data: staff }] = await Promise.all([
    supabase.from("support_ticket_messages").select("id, author_id, from_staff, internal, body, created_at").eq("ticket_id", id).order("id"),
    supabase.rpc("admin_support_tickets", { p_search: k.ticket_number, p_limit: 1 }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).is("removed_at", null).order("full_name"),
  ]);
  const row = list?.[0];
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  return (
    <>
      <Link href="/admin/support" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Support tickets</Link>
      <PageHeader title={`${k.ticket_number} · ${k.subject}`} description={`${TICKET_TOPIC[k.category] ?? k.category} · opened ${formatDateTime(k.created_at, "en")}`}
        actions={<Badge variant={TICKET_VARIANT[k.status] ?? "secondary"} data-testid="ticket-status">{TICKET_LABEL[k.status] ?? k.status}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Panel title="Customer's report">
            <p className="text-sm whitespace-pre-wrap">{k.details}</p>
          </Panel>
          <Panel title="Conversation">
            <ol className="space-y-3" data-testid="ticket-messages">
              {(messages ?? []).length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
              {(messages ?? []).map((m) => (
                <li key={m.id} className={cn("rounded-lg border p-3 text-sm", m.internal ? "border-dashed bg-warning/10" : m.from_staff ? "bg-primary/5" : "bg-card")}>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {m.from_staff ? (names.get(m.author_id ?? "") ?? "Staff") : `Customer (User ID ${row?.member_id ?? "—"})`}
                    {m.internal && <Badge variant="warning" className="ml-2">Internal note</Badge>} · {formatDateTime(m.created_at, "en")}
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ol>
          </Panel>
          {canManage && (
            <Panel title="Answer or update">
              <ActionForm action={updateTicket} hidden={{ ticketId: k.id }} submitLabel="Save" resetOnSuccess className="space-y-3">
                <label className="block text-sm">Message
                  <textarea name="message" rows={4} maxLength={3000} placeholder="Write to the customer (they get an email and a phone notification)…" className={`${fieldClass} mt-1 h-auto py-2`} />
                </label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" className="size-4 accent-[var(--primary)]" /> Internal note (only staff see it)</label>
                <div className="flex flex-wrap gap-3">
                  <label className="text-sm">Status
                    <select name="status" defaultValue="" className={`${fieldClass} mt-1 block w-auto`}>
                      <option value="">{k.status === "open" || k.status === "in_progress" ? "Keep (a reply → waiting for customer)" : "Keep as is"}</option>
                      {Object.entries(TICKET_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Assigned to
                    <select name="assignee" defaultValue="" className={`${fieldClass} mt-1 block w-auto`}>
                      <option value="">{k.assigned_to ? `Keep: ${names.get(k.assigned_to) ?? "staff"}` : "Nobody (keep)"}</option>
                      {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      {k.assigned_to && <option value="none">Unassign</option>}
                    </select>
                  </label>
                </div>
              </ActionForm>
            </Panel>
          )}
        </div>
        <div className="space-y-4">
          <Panel title="Customer">
            <dl className="space-y-1 text-sm">
              <div>{k.user_id ? <Link href={`/admin/customers/${k.user_id}`} className="font-medium text-primary hover:underline">{row?.customer_name || row?.email}</Link> : "—"}</div>
              <div className="break-all text-muted-foreground">{row?.email}</div>
              <div data-testid="ticket-user-id"><UserIdLink id={row?.member_id} /></div>
              {row?.member_id && <Link href={`/admin/activity?q=${row.member_id}`} className="text-xs text-primary hover:underline">Their activity</Link>}
            </dl>
          </Panel>
          <Panel title="Details">
            <dl className="space-y-1 text-sm">
              <div>Topic: {TICKET_TOPIC[k.category] ?? k.category}</div>
              {k.order_number && <div>Order: {k.order_id ? <Link href={`/admin/orders/${k.order_id}`} className="text-primary hover:underline">{k.order_number}</Link> : k.order_number}</div>}
              <div>Assigned to: {k.assigned_to ? names.get(k.assigned_to) ?? "staff" : "nobody"}</div>
              <div>Rating: {k.rating ? <>{"★".repeat(k.rating)} ({k.rating}/5){k.rating_comment && <span className="block text-muted-foreground">“{k.rating_comment}”</span>}</> : "not rated"}</div>
              {k.resolved_at && <div>Resolved: {formatDateTime(k.resolved_at, "en")}</div>}
              {k.closed_at && <div>Closed: {formatDateTime(k.closed_at, "en")}</div>}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
