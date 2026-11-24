import type { Metadata } from "next";
import { Phone, RefreshCw } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { fieldClass } from "@/components/admin/ui";
import { BusinessInstallCard } from "@/components/pwa/business-install";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/guards";
import { handToCustomer, receiveFromCourier } from "@/lib/business/actions";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Orders" };

type Row = {
  order_id: string; order_number: string; stage: string; courier_name: string | null; courier_phone: string | null;
  shop_code: string | null; shop_confirmed: boolean; courier_confirmed: boolean; handoff_locked: boolean;
  customer_name: string | null; customer_phone: string | null; pin_locked: boolean; paid_at: string | null; at_shop_at: string | null; collected_at: string | null;
};

const pinInput = (label: string, aria: string) => (
  <label className="flex-1 text-sm">{label}
    <input name="code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="off" aria-label={aria}
      className={`${fieldClass} mt-1 text-center font-mono text-lg tracking-[0.5em]`} />
  </label>
);

/**
 * The shop's orders: coming with a courier (PINs both ways), waiting at the shop for the customer (customer's PIN),
 * expected (paid, not yet on the way) and collected in the last 7 days.
 */
export default async function BusinessOrdersPage() {
  await requirePermission("partner.own");
  const { data } = await (await createSupabaseServerClient()).rpc("partner_orders");
  const rows = (data ?? []) as Row[];
  const by = (s: string) => rows.filter((r) => r.stage === s);
  return (
    <div className="space-y-5">
      <BusinessInstallCard />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <a href="/business" className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary"><RefreshCw className="size-4" aria-hidden /> Refresh</a>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Courier on the way <span className="text-muted-foreground">({by("incoming").length})</span></h2>
        {by("incoming").length === 0 && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No courier is on the way to you.</p>}
        {by("incoming").map((r) => (
          <article key={r.order_id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="incoming-order">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold">{r.order_number}</span>
              <Badge variant="info">On the way</Badge>
            </div>
            <p className="text-sm">Customer: <span className="font-medium">{r.customer_name}</span></p>
            {r.courier_name && (
              <p className="text-sm">Courier: <span className="font-medium">{r.courier_name}</span>
                {r.courier_phone && <> · <a href={`tel:${r.courier_phone}`} className="inline-flex items-center gap-1 text-primary"><Phone className="size-3.5" aria-hidden />{formatEthiopianPhone(r.courier_phone)}</a></>}</p>
            )}
            {r.handoff_locked ? <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">Too many wrong PINs — hand-over locked. Call the Abiye office.</p> : (
              <>
                <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3 text-center" data-testid="shop-pin">
                  <p className="text-xs font-medium">Your shop PIN — tell it to the courier</p>
                  <p className="font-mono text-3xl font-bold tracking-[0.4em]">{r.shop_code}</p>
                  <p className="text-xs text-muted-foreground">{r.courier_confirmed ? "✓ The courier has entered it." : "Waiting for the courier to enter it."}</p>
                </div>
                {r.shop_confirmed ? <p className="text-sm text-success">✓ You checked the courier&apos;s PIN.</p> : (
                  <ActionForm action={receiveFromCourier} hidden={{ orderId: r.order_id }} submitLabel="Received" className="flex items-end gap-2 space-y-0 [&_button]:shrink-0">
                    {pinInput("Courier's 4-digit PIN", `Courier PIN for ${r.order_number}`)}
                  </ActionForm>
                )}
              </>
            )}
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">At the shop — waiting for the customer <span className="text-muted-foreground">({by("at_shop").length})</span></h2>
        {by("at_shop").length === 0 && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No orders waiting for customers.</p>}
        {by("at_shop").map((r) => (
          <article key={r.order_id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="at-shop-order">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold">{r.order_number}</span>
              <Badge variant="accent">At the shop</Badge>
              {r.at_shop_at && <span className="ml-auto text-xs text-muted-foreground">since {formatDateTime(r.at_shop_at, "en")}</span>}
            </div>
            <p className="text-sm">Customer: <span className="font-medium">{r.customer_name}</span>
              {r.customer_phone && <> · <a href={`tel:${r.customer_phone}`} className="inline-flex items-center gap-1 text-primary"><Phone className="size-3.5" aria-hidden />{formatEthiopianPhone(r.customer_phone)}</a></>}</p>
            {r.pin_locked ? <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">Too many wrong PINs — order locked. Call the Abiye office.</p> : (
              <ActionForm action={handToCustomer} hidden={{ orderId: r.order_id }} submitLabel="Handed over" className="flex items-end gap-2 space-y-0 [&_button]:shrink-0">
                {pinInput("Customer's 4-digit PIN", `Customer PIN for ${r.order_number}`)}
              </ActionForm>
            )}
            <p className="text-xs text-muted-foreground">Give the order only after the PIN is accepted.</p>
          </article>
        ))}
      </section>

      {by("expected").length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Coming soon (paid, being prepared)</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {by("expected").map((r) => (
              <li key={r.order_id} className="flex flex-wrap items-center gap-2 px-4 py-2" data-testid="expected-order">
                <span className="font-mono">{r.order_number}</span>
                <span>{r.customer_name}</span>
                <span className="text-xs text-muted-foreground">{r.courier_name ? `courier ${r.courier_name}` : "no courier yet"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {by("collected").length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Collected in the last 7 days</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm" data-testid="collected-list">
            {by("collected").map((r) => (
              <li key={r.order_id} className="flex items-center gap-2 px-4 py-2">
                <span className="font-mono">{r.order_number}</span>
                <span className="ml-auto text-xs text-muted-foreground">{r.collected_at ? formatDateTime(r.collected_at, "en") : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
