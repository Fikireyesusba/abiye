import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { UserIdLink } from "@/components/admin/user-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { uploadRingtone } from "@/lib/admin/courier-admin-actions";
import { assignCourier } from "@/lib/admin/order-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime, zoneToday } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Couriers & delivery" };
const etb = (n: number | string | null | undefined) => formatETB(toSantim(Number(n ?? 0)));
const VEHICLE: Record<string, string> = { on_foot: "On foot", bicycle: "Bicycle", motorcycle: "Motorcycle", car: "Car" };

/**
 * Shop ↔ couriers: who is online now (and for which cities), Dispatch (paid delivery orders waiting,
 * couriers available for the order's city first), the couriers, the ringtone and the Excel of courier orders.
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
  const online = active.filter((c) => c.on_duty);
  const TABS = [
    ...(canDispatch ? [{ key: "dispatch", label: "Dispatch", count: (waiting ?? []).length, alert: true }] : []),
    { key: "couriers", label: "Couriers" },
    ...(canManage ? [{ key: "ringtone", label: "Ringtone" }, { key: "excel", label: "Excel" }] : []),
  ];
  const tab = pickTab(TABS, (await searchParams).tab);
  const ringtone = (setting?.value as { ringtone_path?: string } | null)?.ringtone_path ?? null;
  const ringUrl = ringtone ? publicImageUrl("app-sounds", ringtone) : null;

  return (
    <>
      <PageHeader title="Couriers & delivery" description="Who is online, give paid delivery orders to couriers available for that city, and pay them the city's delivery price per delivered order." />

      <section className="mb-5 rounded-xl border bg-card p-4" data-testid="online-couriers">
        <h2 className="mb-2 text-sm font-medium">Online now <span className="text-muted-foreground">({online.length} of {active.length})</span></h2>
        {online.length === 0 ? <p className="text-sm text-muted-foreground">No courier is on duty right now.</p> : (
          <ul className="flex flex-wrap gap-2">
            {online.map((c) => (
              <li key={c.id} className="rounded-lg border bg-success/5 px-3 py-2 text-sm">
                <span className="font-medium">● {c.full_name}</span> <span className="font-mono text-xs text-muted-foreground">{c.member_id}</span>
                <span className="block text-xs text-muted-foreground">{VEHICLE[c.vehicle ?? ""] ?? "vehicle not set"} · {c.active_deliveries} active · {c.cities || "no city"}</span>
                {c.on_duty_since && <span className="block text-xs text-muted-foreground">since {formatDateTime(c.on_duty_since, "en")}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <SubTabs base="/admin/couriers" tabs={TABS} active={tab} />

      {tab === "dispatch" && canDispatch && (
        <Panel title="Waiting for a courier">
          <p className="mb-3 text-sm text-muted-foreground">Paid delivery orders without a courier (or back after “couldn’t deliver” / declined). For each order, couriers on duty for that city are listed first (●).</p>
          {(waiting ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting — every paid delivery order has a courier.</p> : (
            <ul className="divide-y" data-testid="dispatch-list">
              {(waiting ?? []).map((o) => {
                const forCity = active.filter((c) => c.on_duty && o.zone_id && c.zone_ids.includes(o.zone_id));
                const others = active.filter((c) => !forCity.includes(c));
                return (
                  <li key={o.order_id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/orders/${o.order_id}`} className="font-mono font-semibold text-primary hover:underline">{o.order_number}</Link>
                      <span className="ml-2 text-muted-foreground">{o.partner_shop ? <Badge variant="outline" className="mr-1">to partner shop {o.partner_shop}</Badge> : null}{o.city}{o.address_line ? ` — ${o.address_line}` : ""} · {o.items} item(s) · {etb(o.total_etb)}</span>
                      <span className="block text-xs text-muted-foreground">Courier pay {etb(o.courier_pay_etb)}{Number(o.delivery_fee_etb) < Number(o.courier_pay_etb) ? ` (customer paid ${etb(o.delivery_fee_etb)} after the bigger-purchase discount)` : ""}
                        {o.paid_at ? ` · paid ${formatDateTime(o.paid_at, "en")}` : ""}</span>
                      {o.fail_reason && <span className="block text-xs text-destructive">Last try failed ({o.delivery_attempts}×): {o.fail_reason}</span>}
                      <span className={`block text-xs ${forCity.length ? "text-success" : "text-destructive"}`}>{forCity.length ? `${forCity.length} courier(s) available for ${o.city}` : `No courier on duty for ${o.city}`}</span>
                    </div>
                    <ActionForm action={assignCourier} hidden={{ orderId: o.order_id }} submitLabel="Assign" size="sm" className="flex items-center gap-2 space-y-0">
                      <select name="courier" required defaultValue={o.courier_id ?? ""} className={`${fieldClass} h-8 w-64`} aria-label={`Courier for ${o.order_number}`}>
                        <option value="">Choose a courier…</option>
                        {forCity.length > 0 && <optgroup label={`On duty for ${o.city}`}>{forCity.map((c) => <option key={c.id} value={c.id}>● {c.full_name} · {c.member_id} · {c.active_deliveries} active</option>)}</optgroup>}
                        <optgroup label="Other couriers">{others.map((c) => <option key={c.id} value={c.id}>{c.on_duty ? "● " : "○ "}{c.full_name} · {c.member_id}{c.cities ? ` · ${c.cities}` : ""}</option>)}</optgroup>
                      </select>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          )}
          {active.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No couriers yet: Staff → Add staff member → permission set “Courier”.</p>}
        </Panel>
      )}

      {tab === "couriers" && (
        <Table scroll head={["User ID", "Name", "Status", "Cities", "Vehicle", "Now", "This month", ...(canManage ? ["To pay"] : []), "Last delivery"]} empty="No couriers yet (Staff → permission set Courier).">
          {list.map((c) => (
            <tr key={c.id} data-testid="courier-row">
              <Td><UserIdLink id={c.member_id} /></Td>
              <Td>{canManage ? <Link href={`/admin/couriers/${c.id}`} className="text-primary hover:underline">{c.full_name}</Link> : c.full_name}</Td>
              <Td>{!c.is_active ? <Badge variant="secondary">deactivated</Badge> : c.on_duty ? <Badge variant="success">online</Badge> : <Badge variant="outline">offline</Badge>}</Td>
              <Td className="max-w-[14rem] text-xs">{c.on_duty ? c.cities || "—" : "—"}</Td>
              <Td className="text-sm">{VEHICLE[c.vehicle ?? ""] ?? <span className="text-destructive">not set</span>}{c.plate_number ? ` · ${c.plate_number}` : ""}</Td>
              <Td className="tabular-nums">{c.active_deliveries}</Td>
              <Td className="text-sm tabular-nums">{c.delivered_month} delivered{c.failed_month ? ` · ${c.failed_month} failed` : ""}{c.declined_month ? ` · ${c.declined_month} declined` : ""}</Td>
              {canManage && <Td className="tabular-nums font-medium">{etb(c.unpaid_etb)}</Td>}
              <Td className="text-xs text-muted-foreground">{c.last_delivered_at ? formatDateTime(c.last_delivered_at, "en") : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "ringtone" && canManage && (
        <Panel title="Ringtone for new deliveries" className="max-w-lg">
          <p className="mb-3 text-sm text-muted-foreground">The courier app rings when a delivery is assigned (while the app is open), until the courier taps it. Upload your own sound (MP3, OGG, WAV or M4A, max 2 MB), or keep the built-in ring.</p>
          {ringUrl ? (
            <div className="mb-3 space-y-2">
              <audio controls src={ringUrl} className="w-full" data-testid="ringtone-player" />
              <ActionForm action={uploadRingtone} hidden={{ remove: "1" }} submitLabel="Remove (use the built-in ring)" variant="outline" size="sm" />
            </div>
          ) : <p className="mb-3 text-sm">Now: built-in ring.</p>}
          <ActionForm action={uploadRingtone} submitLabel="Upload ringtone">
            <input name="file" type="file" required accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,.mp3,.ogg,.wav,.m4a" aria-label="Ringtone file" className={fieldClass} />
          </ActionForm>
        </Panel>
      )}

      {tab === "excel" && canManage && (
        <Panel title="Excel: orders handled by couriers" className="max-w-lg">
          <form method="get" action="/admin/exports/download" className="space-y-3" data-testid="courier-orders-export">
            <input type="hidden" name="kind" value="courier_orders" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input type="date" name="from" required defaultValue={`${zoneToday().slice(0, 7)}-01`} className={fieldClass} /></Field>
              <Field label="To"><input type="date" name="to" required defaultValue={zoneToday()} className={fieldClass} /></Field>
            </div>
            <Field label="Courier">
              <select name="courier" defaultValue="" className={fieldClass}>
                <option value="">All couriers</option>
                {list.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {c.member_id}</option>)}
              </select>
            </Field>
            <Button type="submit" variant="outline"><Download /> Excel</Button>
            <p className="text-xs text-muted-foreground">Order, courier (User ID), city, status, assigned / picked up / delivered times, attempts, delivery fee paid, full city price, courier earned and when it was paid out.</p>
          </form>
        </Panel>
      )}
    </>
  );
}
