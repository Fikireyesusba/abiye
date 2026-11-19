import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, Table, Td, fieldClass } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { Badge } from "@/components/ui/badge";
import { actionLabel, describeChanges } from "@/lib/admin/activity";
import { deleteCustomer, resendCustomerInvite, sendCustomerPasswordReset, setCustomerActive } from "@/lib/admin/customer-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { isGuid } from "@/lib/orders/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const ctx = await requirePermission("customers.view");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: rows }, { data: orders }, { data: activity }] = await Promise.all([
    supabase.rpc("admin_customer_accounts", { p_user_id: id, p_limit: 1 }),
    supabase.from("orders").select("id, order_number, total_etb, status, payment_status, fulfillment_method, city, address_line, created_at")
      .eq("user_id", id).order("created_at", { ascending: false }),
    supabase.rpc("admin_customer_activity", { p_user_id: id, p_limit: 200 }),
  ]);
  const c = rows?.[0];
  if (!c) notFound();
  const verified = (orders ?? []).filter((o) => o.payment_status === "verified").reduce((s, o) => s + Number(o.total_etb), 0);
  const canManage = ctx.permissions.has("customers.manage");
  const hidden = { userId: c.id };
  const addresses = [...new Set((orders ?? []).filter((o) => o.address_line).map((o) => `${o.city} — ${o.address_line}`))];

  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Customers</Link>
      <PageHeader title={c.full_name || c.email} description={`${c.email} · joined ${formatDateTime(c.created_at, "en")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {c.deactivated_at && <Badge variant="destructive">Deactivated</Badge>}
            {c.is_staff && <Badge variant="secondary">Staff</Badge>}
            {c.email_confirmed_at ? <Badge variant="success">Email confirmed</Badge> : <Badge variant="warning">Email not confirmed</Badge>}
          </div>
        } />
      {c.deactivated_at && (
        <p role="status" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          Deactivated {formatDateTime(c.deactivated_at, "en")}{c.deactivated_by_name ? ` by ${c.deactivated_by_name}` : ""}. Reason: {c.deactivation_reason || "—"}.
          This customer cannot sign in or place orders.
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
        <h2 className="text-base font-semibold">Purchase history</h2>
        <Table head={["Order", "Total", "Status", "Payment", "Placed"]} empty="No orders yet.">
          {(orders ?? []).map((o) => (
            <tr key={o.id}>
              <Td>{ctx.permissions.has("orders.view_all") ? <Link href={`/admin/orders/${o.id}`} className="text-primary hover:underline">{o.order_number}</Link> : o.order_number}</Td>
              <Td className="tabular-nums">{formatETB(toSantim(o.total_etb))}</Td>
              <Td><StatusBadge kind="order" status={o.status} /></Td>
              <Td><StatusBadge kind="payment" status={o.payment_status} /></Td>
              <Td className="text-xs text-muted-foreground">{formatDateTime(o.created_at, "en")}</Td>
            </tr>
          ))}
        </Table>
        <Panel title="Activity">
          {(activity ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded yet.</p> : (
            <ol className="space-y-3">
              {(activity ?? []).map((a, i) => {
                const d = (a.details ?? {}) as Record<string, unknown>;
                const changes = a.action === "profile_updated"
                  ? describeChanges((d.before as unknown) ?? null, (d.after as unknown) ?? null) : [];
                const meta = (d.metadata ?? {}) as Record<string, unknown>;
                const extra = [
                  a.reference,
                  typeof d.total_etb === "number" || typeof d.total_etb === "string" ? formatETB(toSantim(Number(d.total_etb))) : null,
                  typeof d.amount_etb === "number" || typeof d.amount_etb === "string" ? formatETB(toSantim(Number(d.amount_etb))) : null,
                  d.from && d.to ? `${String(d.from).replaceAll("_", " ")} → ${String(d.to).replaceAll("_", " ")}` : null,
                  typeof meta.reason === "string" && meta.reason ? `Reason: ${meta.reason}` : null,
                  typeof d.note === "string" ? `Note: ${d.note}` : null,
                ].filter(Boolean);
                return (
                  <li key={`${a.at}-${i}`} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-3">
                    <span className="shrink-0 text-xs sm:w-36 text-muted-foreground tabular-nums">{formatDateTime(a.at, "en")}</span>
                    <div className="min-w-0">
                      <p>
                        <span className="font-medium">{actionLabel(a.action)}</span>
                        {extra.length > 0 && <span className="text-muted-foreground"> · {extra.join(" · ")}</span>}
                      </p>
                      {a.actor_name && a.actor_name !== "service_role" && <p className="text-xs text-muted-foreground">by {a.actor_name}</p>}
                      {changes.length > 0 && <ul className="mt-1 text-xs break-words text-muted-foreground">{changes.map((x) => <li key={x}>{x}</li>)}</ul>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
        </div>
        <div className="space-y-6">
          {canManage && (
            <Panel title="Manage account">
              {c.is_staff ? (
                <p className="text-sm text-muted-foreground">This is a staff account. Manage it under <Link href="/admin/staff" className="text-primary underline">Staff</Link>.</p>
              ) : (
                <div className="space-y-5">
                  {!c.deactivated_at && (c.email_confirmed_at ? (
                    <ActionForm action={sendCustomerPasswordReset} hidden={hidden} submitLabel="Send password reset email" variant="outline" size="sm">
                      <p className="text-xs text-muted-foreground">The customer gets an email with a link to choose a new password. You never see their password.</p>
                    </ActionForm>
                  ) : (
                    <ActionForm action={resendCustomerInvite} hidden={hidden} submitLabel="Send invitation again" variant="outline" size="sm">
                      <p className="text-xs text-muted-foreground">Not confirmed yet. Sends an invitation email with a link to set a password.</p>
                    </ActionForm>
                  ))}
                  {c.deactivated_at ? (
                    <ActionForm action={setCustomerActive} hidden={{ ...hidden, active: "true" }} submitLabel="Reactivate account" size="sm">
                      <p className="text-xs text-muted-foreground">Allows signing in and ordering again.</p>
                    </ActionForm>
                  ) : (
                    <ActionForm action={setCustomerActive} hidden={{ ...hidden, active: "false" }} submitLabel="Deactivate account" variant="destructive" size="sm"
                      confirm="Deactivate this account? The customer will not be able to sign in or place orders.">
                      <label htmlFor="reason" className="text-sm font-medium">Reason (kept in the activity log)</label>
                      <textarea id="reason" name="reason" required maxLength={500} rows={2} className={fieldClass} />
                    </ActionForm>
                  )}
                  {c.order_count === 0 ? (
                    <ActionForm action={deleteCustomer} hidden={hidden} submitLabel="Delete account" variant="destructive" size="sm"
                      confirm={`Permanently delete ${c.email}? This cannot be undone.`}>
                      <p className="text-xs text-muted-foreground">Removes the account and its saved details. Only possible for accounts without orders or printing jobs.</p>
                    </ActionForm>
                  ) : (
                    <p className="text-xs text-muted-foreground">Accounts with orders cannot be deleted (order history must be kept). Deactivate instead.</p>
                  )}
                </div>
              )}
            </Panel>
          )}
          <Panel title="Contact">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted-foreground">Email</dt><dd className="break-all"><a href={`mailto:${c.email}`} className="text-primary">{c.email}</a></dd></div>
              <div><dt className="text-muted-foreground">Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone}`} className="text-primary">{formatEthiopianPhone(c.phone)}</a> : "—"}</dd></div>
              <div><dt className="text-muted-foreground">Last sign-in</dt><dd>{c.last_sign_in_at ? formatDateTime(c.last_sign_in_at, "en") : "never"}</dd></div>
            </dl>
          </Panel>
          {ctx.permissions.has("analytics.view") && <Panel title="Verified spend"><p className="text-2xl font-semibold">{formatETB(toSantim(verified))}</p></Panel>}
          {addresses.length > 0 && (
            <Panel title="Delivery addresses">
              <ul className="space-y-2 text-sm">{addresses.map((a) => <li key={a}>{a}</li>)}</ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
