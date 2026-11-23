import type { Metadata } from "next";
import { MapPin, Phone, RefreshCw } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/guards";
import { couldNotDeliver, deliver, pickUp } from "@/lib/courier/actions";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My deliveries <span className="text-muted-foreground">({open.length})</span></h1>
        <a href="/courier" className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary"><RefreshCw className="size-4" aria-hidden /> Refresh</a>
      </div>
      {open.length === 0 && <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">No deliveries assigned to you right now.</p>}
      <ul className="space-y-4">
        {open.map((d) => {
          const onTheWay = d.status === "out_for_delivery";
          const items = (d.items as { name: string; quantity: number }[] | null) ?? [];
          const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.address_line, d.city, "Ethiopia"].filter(Boolean).join(", "))}`;
          return (
            <li key={d.order_id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="delivery">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-semibold">{d.order_number}</span>
                <Badge variant={onTheWay ? "info" : "secondary"}>{onTheWay ? "On the way" : "To pick up"}</Badge>
                <span className="ml-auto text-sm tabular-nums text-muted-foreground">{formatETB(toSantim(Number(d.total_etb)))} · paid</span>
              </div>
              {d.fail_reason && !onTheWay && <p className="rounded-md bg-warning/10 p-2 text-sm">Last try failed: {d.fail_reason}</p>}
              <div className="space-y-1 text-sm">
                <p className="font-medium">{d.customer_name}</p>
                {d.customer_phone && (
                  <a href={`tel:${d.customer_phone}`} className="inline-flex items-center gap-1 text-primary"><Phone className="size-4" aria-hidden /> {formatEthiopianPhone(d.customer_phone)}</a>
                )}
                <a href={map} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1 text-primary">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{[d.city, d.address_line].filter(Boolean).join(" — ")}</span>
                </a>
                {d.delivery_instructions && <p className="text-muted-foreground">Note: {d.delivery_instructions}</p>}
              </div>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {items.map((i, k) => <li key={k}>{i.name} × {i.quantity}</li>)}
              </ul>
              {!onTheWay ? (
                <ActionForm action={pickUp} hidden={{ orderId: d.order_id }} submitLabel="Picked up — on my way" className="[&_button]:w-full" />
              ) : (
                <div className="space-y-3 border-t pt-3">
                  <ActionForm action={deliver} hidden={{ orderId: d.order_id }} submitLabel="Delivered" className="flex items-end gap-2 space-y-0 [&_button]:shrink-0">
                    <label className="flex-1 text-sm">Customer&apos;s 4-digit code
                      <input name="code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="off" className={`${fieldClass} mt-1 text-center font-mono text-lg tracking-[0.5em]`} aria-label={`Delivery code for ${d.order_number}`} />
                    </label>
                  </ActionForm>
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
