import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { UserIdLink } from "@/components/admin/user-id";
import { Badge } from "@/components/ui/badge";
import { saveCourierFee } from "@/lib/admin/courier-admin-actions";
import { assignCourier } from "@/lib/admin/order-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Couriers & delivery" };
const etb = (n: number | string | null | undefined) => formatETB(toSantim(Number(n ?? 0)));
const VEHICLE: Record<string, string> = { motorbike: "Motorbike", bicycle: "Bicycle", car: "Car", on_foot: "On foot", other: "Other" };

/**
 * Shop ↔ couriers: Dispatch (paid delivery orders waiting for a courier, on-duty couriers first),
 * the couriers (Super Admin: details, earnings, payouts) and the fee per delivery.
 */
export default async function CouriersPage({ searchParams }: PageProps<"/admin/couriers">) {
  const ctx = await requirePermission("couriers.manage", "orders.manage");
  const canDispatch = ctx.permissions.has("orders.manage");
  const canManage = ctx.permissions.has("couriers.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: couriers }, { data: waiting }, { data: setting }] = await Promise.all([
    supabase.rpc("admin_couriers"),
    canDispatch ? supabase.rpc("admin_dispatch_orders") : Promise.resolve({ data: [] }),
    canManage ? supabase.from("website_settings").select("value").eq("key", "courier").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const list = couriers ?? [];
  const active = list.filter((c) => c.is_active);
  const onDuty = active.filter((c) => c.on_duty);
  const TABS = [
    ...(canDispatch ? [{ key: "dispatch", label: "Dispatch", count: (waiting ?? []).length, alert: true }] : []),
    { key: "couriers", label: onDuty.length ? `Couriers (${onDuty.length} on duty)` : "Couriers" },
    ...(canManage ? [{ key: "settings", label: "Fee per delivery" }] : []),
  ];
  const tab = pickTab(TABS, (await searchParams).tab);
  const option = (c: (typeof list)[number]) => `${c.on_duty ? "● " : "○ "}${c.full_name} · ${c.member_id ?? ""} · ${c.active_deliveries} active`;

  return (
    <>
      <PageHeader title="Couriers & delivery" description="Give paid delivery orders to couriers, follow them, and pay couriers a fixed fee per delivered order." />
      <SubTabs base="/admin/couriers" tabs={TABS} active={tab} />

      {tab === "dispatch" && canDispatch && (
        <Panel title="Waiting for a courier">
          <p className="mb-3 text-sm text-muted-foreground">Paid delivery orders without a courier (or back after “couldn’t deliver”). On-duty couriers (●) are listed first with how many deliveries they have now.</p>
          {(waiting ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting — every paid delivery order has a courier.</p> : (
            <ul className="divide-y" data-testid="dispatch-list">
              {(waiting ?? []).map((o) => (
                <li key={o.order_id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/orders/${o.order_id}`} className="font-mono font-semibold text-primary hover:underline">{o.order_number}</Link>
                    <span className="ml-2 text-muted-foreground">{o.city}{o.address_line ? ` — ${o.address_line}` : ""} · {o.items} item(s) · {etb(o.total_etb)}</span>
                    {o.fail_reason && <span className="block text-xs text-destructive">Last try failed ({o.delivery_attempts}×): {o.fail_reason}</span>}
                    {o.paid_at && <span className="block text-xs text-muted-foreground">Paid {formatDateTime(o.paid_at, "en")}</span>}
                  </div>
                  <ActionForm action={assignCourier} hidden={{ orderId: o.order_id }} submitLabel="Assign" size="sm" className="flex items-center gap-2 space-y-0">
                    <select name="courier" required defaultValue={o.courier_id ?? ""} className={`${fieldClass} h-8 w-60`} aria-label={`Courier for ${o.order_number}`}>
                      <option value="">Choose a courier…</option>
                      {active.map((c) => <option key={c.id} value={c.id}>{option(c)}</option>)}
                    </select>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          {active.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No couriers yet: Staff → Add staff member → permission set “Courier”.</p>}
        </Panel>
      )}

      {tab === "couriers" && (
        <Table scroll head={["User ID", "Name", "Status", "Vehicle", "Now", "This month", ...(canManage ? ["To pay", "Fee"] : []), "Last delivery"]} empty="No couriers yet (Staff → permission set Courier).">
          {list.map((c) => (
            <tr key={c.id} data-testid="courier-row">
              <Td><UserIdLink id={c.member_id} /></Td>
              <Td>{canManage ? <Link href={`/admin/couriers/${c.id}`} className="text-primary hover:underline">{c.full_name}</Link> : c.full_name}</Td>
              <Td>{!c.is_active ? <Badge variant="secondary">deactivated</Badge> : c.on_duty ? <Badge variant="success">on duty</Badge> : <Badge variant="outline">off duty</Badge>}</Td>
              <Td className="text-sm">{VEHICLE[c.vehicle] ?? c.vehicle}{c.plate_number ? ` · ${c.plate_number}` : ""}</Td>
              <Td className="tabular-nums">{c.active_deliveries}</Td>
              <Td className="text-sm tabular-nums">{c.delivered_month} delivered{c.failed_month ? ` · ${c.failed_month} failed` : ""}</Td>
              {canManage && <Td className="tabular-nums font-medium">{etb(c.unpaid_etb)}</Td>}
              {canManage && <Td className="text-sm tabular-nums">{etb(c.fee_etb)}{c.fee_override_etb !== null ? " (own)" : ""}</Td>}
              <Td className="text-xs text-muted-foreground">{c.last_delivered_at ? formatDateTime(c.last_delivered_at, "en") : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "settings" && canManage && (
        <Panel title="Fee per delivery" className="max-w-md">
          <ActionForm action={saveCourierFee} submitLabel="Save">
            <Field label="Amount a courier earns for each delivered order (ETB)" hint="A courier can have their own amount (open the courier). Changes apply to deliveries from now on.">
              <input name="fee" type="number" min={0} step="0.01" required defaultValue={Number((setting?.value as { fee_per_delivery_etb?: number } | null)?.fee_per_delivery_etb ?? 100)} className={fieldClass} />
            </Field>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
