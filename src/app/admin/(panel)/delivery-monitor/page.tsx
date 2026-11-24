import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { UserIdLink } from "@/components/admin/user-id";
import { Badge } from "@/components/ui/badge";
import { saveDeliveryMonitor } from "@/lib/admin/courier-admin-actions";
import { actionLabel } from "@/lib/admin/activity";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Delivery monitor" };

type Monitor = {
  settings: { enabled?: boolean; dispatch_wait_hours?: number; pickup_hours?: number; delivery_hours?: number; shop_collect_days?: number; wrong_pin_alert?: number; last_scan_at?: string };
  counts: Record<string, number>;
  overdue: { order_id: string; order_number: string; kind: string; since: string; hours: number; courier_user_id: string | null; courier: string | null; city: string | null; shop: string | null }[];
  people: { id: string; member_id: string | null; full_name: string; is_active: boolean; app: string; shop: string | null; on_duty: boolean; last_sign_in_at: string | null; last_action_at: string | null; wrong_pins_today: number }[];
  events: { id: number; at: string; action: string; user_id: string | null; name: string | null; actor_role: string | null; order_number: string | null; detail: Record<string, unknown> }[];
};

const KIND: Record<string, string> = {
  not_dispatched: "No courier yet", not_picked_up: "Not picked up", delivery_late: "On the way too long", not_collected: "Not collected at the shop",
};
const PIN: Record<string, string> = { customer_pin_at_door: "customer PIN (door)", customer_pin_at_shop: "customer PIN (shop)", handover_pin: "hand-over PIN" };
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Courier and Business apps: what is happening now, what is late, who was active, and every app event. Alerts go to Telegram. */
export default async function DeliveryMonitorPage({ searchParams }: PageProps<"/admin/delivery-monitor">) {
  const ctx = await requirePermission("couriers.manage", "orders.manage", "partners.manage");
  const canSet = ctx.permissions.has("couriers.manage");
  const sp = await searchParams;
  const { data, error } = await (await createSupabaseServerClient()).rpc("admin_delivery_monitor", { p_events: 300 });
  if (error || !data) return <PageHeader title="Delivery monitor" description="Could not load the monitor. Please refresh." />;
  const m = data as unknown as Monitor;
  const s = m.settings;
  const app = sp.app === "courier" || sp.app === "business" ? sp.app : "";
  const events = m.events.filter((e) => !app || (app === "business" ? e.actor_role === "partner" || (e.detail.app === "business") : e.actor_role !== "partner" && e.detail.app !== "business"));
  const TABS = [
    { key: "now", label: "Now", count: m.overdue.length, alert: true },
    { key: "people", label: "Couriers & shop staff" },
    { key: "log", label: "App log" },
    ...(canSet ? [{ key: "alerts", label: "Alert settings" }] : []),
  ];
  const tab = pickTab(TABS, sp.tab);
  const cards: [string, number, boolean?][] = [
    ["Waiting for a courier", m.counts.waiting_courier], ["To pick up", m.counts.to_pick_up], ["On the way", m.counts.on_the_way],
    ["At partner shops", m.counts.at_shops], ["Couriers online", m.counts.couriers_online], ["Delivered today", m.counts.delivered_today],
    ["Wrong PINs today", m.counts.wrong_pins_today, m.counts.wrong_pins_today > 0], ["Locked (5 wrong PINs)", m.counts.locked, m.counts.locked > 0],
  ];

  return (
    <>
      <PageHeader title="Delivery monitor" description={`Courier and Abiye Business apps. Late deliveries and repeated wrong PINs are alerted on Telegram${s.enabled === false ? " (alerts are switched OFF)" : ""}. Last check ${ago(s.last_scan_at ?? null)}.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="monitor-cards">
        {cards.map(([label, n, warn]) => (
          <div key={label} className={`rounded-xl border bg-card p-3 ${warn ? "border-destructive/40" : ""}`}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>{n ?? 0}</p>
          </div>
        ))}
      </div>
      <SubTabs base="/admin/delivery-monitor" tabs={TABS} active={tab} />

      {tab === "now" && (
        <Panel title={`Late right now (${m.overdue.length})`}>
          {m.overdue.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is late. 👍</p> : (
            <ul className="divide-y text-sm" data-testid="overdue-list">
              {m.overdue.map((o) => (
                <li key={`${o.order_id}-${o.kind}`} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge variant="destructive">{KIND[o.kind] ?? o.kind}</Badge>
                  <Link href={`/admin/orders/${o.order_id}`} className="font-mono font-semibold text-primary hover:underline">{o.order_number}</Link>
                  <span className="text-muted-foreground">{o.shop ? `partner shop ${o.shop} · ` : ""}{o.city ?? ""}{o.courier ? ` · courier ${o.courier}` : ""}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{o.hours} h · since {formatDateTime(o.since, "en")}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Limits: no courier after {s.dispatch_wait_hours ?? 2} h · not picked up {s.pickup_hours ?? 2} h after assignment · on the way more than {s.delivery_hours ?? 6} h ·
            waiting at a partner shop more than {s.shop_collect_days ?? 3} days. Each late order is alerted once per step in the orders &amp; payments group.
          </p>
        </Panel>
      )}

      {tab === "people" && (
        <Table scroll head={["User ID", "Name", "App", "Status", "Last activity", "Last sign-in", "Wrong PINs today"]} empty="No couriers or partner shop staff yet.">
          {m.people.map((p) => (
            <tr key={p.id} data-testid="monitor-person">
              <Td><UserIdLink id={p.member_id ?? undefined} /></Td>
              <Td>{p.full_name}</Td>
              <Td>{p.app === "courier" ? "Courier" : `Business${p.shop ? ` · ${p.shop}` : " · no shop"}`}</Td>
              <Td>{!p.is_active ? <Badge variant="secondary">deactivated</Badge> : p.app === "courier" ? (p.on_duty ? <Badge variant="success">on duty</Badge> : <Badge variant="outline">off duty</Badge>) : <Badge variant="outline">active</Badge>}</Td>
              <Td className="text-xs">{ago(p.last_action_at)}</Td>
              <Td className="text-xs">{p.last_sign_in_at ? formatDateTime(p.last_sign_in_at, "en") : "never"}</Td>
              <Td className={`tabular-nums ${p.wrong_pins_today > 0 ? "font-semibold text-destructive" : ""}`}>{p.wrong_pins_today}</Td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "log" && (
        <>
          <div className="mb-3 flex gap-2 text-sm">
            {[["", "All"], ["courier", "Courier app"], ["business", "Business app"]].map(([k, l]) => (
              <Link key={k} href={`/admin/delivery-monitor?tab=log${k ? `&app=${k}` : ""}`} className={`rounded-md border px-3 py-1 ${app === k ? "border-primary bg-primary/5 text-primary" : ""}`}>{l}</Link>
            ))}
          </div>
          <Table scroll head={["When", "Event", "Order", "By", "Details"]} empty="No events yet.">
            {events.map((e) => (
              <tr key={e.id} data-testid="monitor-event">
                <Td className="whitespace-nowrap text-xs">{formatDateTime(e.at, "en")}</Td>
                <Td className={e.action === "pin_wrong" || e.action.endsWith("_locked") ? "font-medium text-destructive" : ""}>{actionLabel(e.action)}</Td>
                <Td className="font-mono text-xs">{e.order_number ?? "—"}</Td>
                <Td className="text-xs">{e.name ?? "—"} {e.user_id && <UserIdLink id={e.user_id} />}</Td>
                <Td className="max-w-[22rem] text-xs text-muted-foreground">
                  {e.action === "pin_wrong" ? `${PIN[String(e.detail.pin)] ?? e.detail.pin} · try ${String(e.detail.try)}${e.detail.shop ? ` · ${String(e.detail.shop)}` : ""}`
                    : [e.detail.reason, e.detail.shop].filter(Boolean).map(String).join(" · ")}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {tab === "alerts" && canSet && (
        <Panel title="When to alert (Telegram)" className="max-w-2xl">
          <ActionForm action={saveDeliveryMonitor} submitLabel="Save" className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="enabled" defaultChecked={s.enabled !== false} className="size-4 accent-[var(--primary)]" /> Alerts on</label>
            <Field label="Paid order without a courier after (hours)"><input name="dispatch_wait_hours" type="number" step="0.25" min={0.25} max={168} required defaultValue={s.dispatch_wait_hours ?? 2} className={fieldClass} /></Field>
            <Field label="Assigned but not picked up after (hours)"><input name="pickup_hours" type="number" step="0.25" min={0.25} max={168} required defaultValue={s.pickup_hours ?? 2} className={fieldClass} /></Field>
            <Field label="On the way longer than (hours)"><input name="delivery_hours" type="number" step="0.25" min={0.25} max={168} required defaultValue={s.delivery_hours ?? 6} className={fieldClass} /></Field>
            <Field label="Waiting at a partner shop longer than (days)"><input name="shop_collect_days" type="number" step="1" min={1} max={60} required defaultValue={s.shop_collect_days ?? 3} className={fieldClass} /></Field>
            <Field label="Security alert at this many wrong PINs on one order" hint="Every wrong PIN is logged; 5 locks the order."><input name="wrong_pin_alert" type="number" min={1} max={4} required defaultValue={s.wrong_pin_alert ?? 3} className={fieldClass} /></Field>
          </ActionForm>
          <p className="mt-3 text-xs text-muted-foreground">Late orders → orders &amp; payments group; wrong PINs → security group. The check runs at most every 5 minutes while the admin, courier or Business app is open, and once a day.</p>
        </Panel>
      )}
    </>
  );
}
