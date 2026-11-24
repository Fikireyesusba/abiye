import type { Metadata } from "next";
import { MapPin, Phone, RefreshCw } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { CourierInstallCard } from "@/components/pwa/courier-install";
import { requirePermission } from "@/lib/auth/guards";
import { couldNotDeliver, declineDelivery, deliver, handOffToShop, pickUp } from "@/lib/courier/actions";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "My deliveries" };

/** The courier's deliveries: only those assigned to them (customer details only while the delivery is open). */
export default async function CourierPage() {
  await requirePermission("deliveries.own");
  const { data } = await (await createSupabaseServerClient()).rpc("courier_deliveries");
  const rows = data ?? [];
  const open = rows.filter((r) => r.active);
  const done = rows.filter((r) => !r.active);
  return (
    <div className="space-y-4">
      <CourierInstallCard />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My deliveries <span className="text-muted-foreground">({open.length})</span></h1>
        <a href="/courier" className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary"><RefreshCw className="size-4" aria-hidden /> Refresh</a>
      </div>
      {open.length === 0 && <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">No deliveries assigned to you right now.</p>}
      <ul className="space-y-4">
        {open.map((d) => {
          const onTheWay = d.status === "out_for_delivery";
          const shop = d.partner_shop;
          const map = (shop && d.partner_map_url) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.address_line, d.city, "Ethiopia"].filter(Boolean).join(", "))}`;
          return (
            <li key={d.order_id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="delivery">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-semibold">{d.order_number}</span>
                <Badge variant={onTheWay ? "info" : "secondary"}>{onTheWay ? "On the way" : "To pick up"}</Badge>
                {shop && <Badge variant="outline">Partner shop</Badge>}
              </div>
              {d.fail_reason && !onTheWay && <p className="rounded-md bg-warning/10 p-2 text-sm">Last try failed: {d.fail_reason}</p>}
              <div className="space-y-1 text-sm">
                <p className="font-medium" data-testid="delivery-customer">Customer: {d.customer_name}</p>
                {shop && <p className="font-medium">Take it to: {shop}</p>}
                {shop && d.partner_phone && (
                  <a href={`tel:${d.partner_phone}`} className="inline-flex items-center gap-1 text-primary"><Phone className="size-4" aria-hidden /> {d.partner_phone}</a>
                )}
                {!shop && d.customer_phone && (
                  <a href={`tel:${d.customer_phone}`} className="inline-flex items-center gap-1 text-primary"><Phone className="size-4" aria-hidden /> {formatEthiopianPhone(d.customer_phone)}</a>
                )}
                <a href={map} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1 text-primary">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{[d.city, d.address_line].filter(Boolean).join(" — ")}</span>
                </a>
                {d.partner_landmark && <p className="text-muted-foreground">Landmark: {d.partner_landmark}</p>}
                {d.partner_hours && <p className="text-muted-foreground">Open: {d.partner_hours}</p>}
                {d.delivery_instructions && <p className="text-muted-foreground">Note: {d.delivery_instructions}</p>}
              </div>
              {!onTheWay ? (
                <div className="space-y-2">
                  <ActionForm action={pickUp} hidden={{ orderId: d.order_id }} submitLabel="Picked up — on my way" className="[&_button]:w-full" />
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Can&apos;t take this delivery?</summary>
                    <ActionForm action={declineDelivery} hidden={{ orderId: d.order_id }} submitLabel="Decline" variant="outline" size="sm" className="mt-2 space-y-2"
                      confirm="Decline this delivery? It goes back to the office and you are set off duty.">
                      <input name="reason" required minLength={3} maxLength={300} placeholder="Why (e.g. motorbike broke down)" aria-label={`Reason for declining ${d.order_number}`} className={fieldClass} />
                    </ActionForm>
                  </details>
                </div>
              ) : (
                <div className="space-y-3 border-t pt-3">
                  {shop ? (
                    <div className="space-y-3" data-testid="handoff">
                      <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3 text-center">
                        <p className="text-xs font-medium">Your hand-over PIN — tell it to the shop</p>
                        <p className="font-mono text-3xl font-bold tracking-[0.4em]" data-testid="courier-handoff-pin">{d.handoff_code}</p>
                        <p className="text-xs text-muted-foreground">{d.handoff_shop_done ? "✓ The shop has entered it." : "Waiting for the shop to enter it."}</p>
                      </div>
                      {d.handoff_courier_done ? <p className="text-sm text-success">✓ You checked the shop&apos;s PIN.</p> : (
                        <ActionForm action={handOffToShop} hidden={{ orderId: d.order_id }} submitLabel="Handed to shop" className="flex items-end gap-2 space-y-0 [&_button]:shrink-0">
                          <label className="flex-1 text-sm">Shop&apos;s 4-digit PIN
                            <input name="code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="off" className={`${fieldClass} mt-1 text-center font-mono text-lg tracking-[0.5em]`} aria-label={`Shop PIN for ${d.order_number}`} />
                          </label>
                        </ActionForm>
                      )}
                    </div>
                  ) : (
                  <ActionForm action={deliver} hidden={{ orderId: d.order_id }} submitLabel="Delivered" className="flex items-end gap-2 space-y-0 [&_button]:shrink-0">
                    <label className="flex-1 text-sm">Customer&apos;s 4-digit PIN
                      <input name="code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="off" className={`${fieldClass} mt-1 text-center font-mono text-lg tracking-[0.5em]`} aria-label={`Delivery code for ${d.order_number}`} />
                    </label>
                  </ActionForm>
                  )}
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Couldn&apos;t deliver?</summary>
                    <ActionForm action={couldNotDeliver} hidden={{ orderId: d.order_id }} submitLabel="Couldn't deliver" variant="outline" size="sm" className="mt-2 space-y-2">
                      <input name="reason" required minLength={3} maxLength={300} placeholder="What happened (e.g. customer not answering)" aria-label={`Reason for ${d.order_number}`} className={fieldClass} />
                    </ActionForm>
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Delivered in the last 24 hours</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {done.map((d) => (
              <li key={d.order_id} className="flex items-center gap-2 px-4 py-2">
                <span className="font-mono">{d.order_number}</span>
                <span className="ml-auto text-xs text-muted-foreground">{d.delivered_at ? formatDateTime(d.delivered_at, "en") : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
