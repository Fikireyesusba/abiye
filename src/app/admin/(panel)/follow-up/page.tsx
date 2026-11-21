import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseUpdateNeeded, PageHeader, SubTabs, Table, Td, isMissingDbFunction, pickTab } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { waitingFor } from "@/lib/admin/activity";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Stalled checkouts" };

const HOURS = [2, 6, 24, 72] as const;

type Row = {
  kind: string; since: string; user_id: string | null; email: string | null; full_name: string | null; phone: string | null;
  reference: string | null; entity_id: string | null; amount_etb: number | null; item_count: number | null; status: string | null; items: unknown;
};

function Contact({ r }: { r: Row }) {
  const wa = r.phone ? `https://wa.me/${r.phone.replace(/^\+/, "")}` : null;
  return (
    <>
      {r.user_id ? <Link href={`/admin/customers/${r.user_id}`} className="font-medium text-primary underline underline-offset-2">{r.full_name || r.email || "Customer"}</Link>
        : <span className="font-medium">{r.full_name || "Guest"}</span>}
      {r.email && <span className="block text-xs break-all text-muted-foreground">{r.email}</span>}
      {r.phone && (
        <span className="block text-xs">
          <a href={`tel:${r.phone}`} className="text-primary underline underline-offset-2">{formatEthiopianPhone(r.phone)}</a>
          {wa && <> · <a href={wa} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">WhatsApp</a></>}
        </span>
      )}
    </>
  );
}

export default async function FollowUpPage({ searchParams }: PageProps<"/admin/follow-up">) {
  const ctx = await requirePermission("customers.view");
  const sp = await searchParams;
  const h = Number(first(sp.hours));
  const hours = (HOURS as readonly number[]).includes(h) ? h : 2;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_stalled_checkouts", { p_hours: hours });
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Stalled checkouts" migration="20261120000018_customer_account_management.sql" />;
  if (error) throw new Error("Could not load stalled checkouts");
  const rows = (data ?? []) as Row[];
  const now = new Date();
  const orders = rows.filter((r) => r.kind === "unpaid_order");
  const printing = rows.filter((r) => r.kind === "unpaid_printing");
  const baskets = rows.filter((r) => r.kind === "basket");
  const money = (n: number | null) => (n === null ? "—" : formatETB(toSantim(n)));
  const canOpenOrders = ctx.permissions.has("orders.view_all");
  const canOpenPrinting = ctx.permissions.has("printing.view");

  const TABS = [
    { key: "orders", label: "Orders not paid", count: orders.length },
    { key: "baskets", label: "Baskets not checked out", count: baskets.length },
    { key: "printing", label: "Printing jobs not paid", count: printing.length },
  ];
  const tab = pickTab(TABS, sp.tab);

  return (
    <>
      <PageHeader title="Stalled checkouts" description={`Customers who started but have not moved forward for more than ${hours} hours. Contact them to help finish.`} />
      <nav aria-label="Waiting time" className="mb-6 flex flex-wrap gap-2">
        {HOURS.map((x) => (
          <Link key={x} href={`/admin/follow-up?hours=${x}&tab=${tab}`} aria-current={x === hours ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", x === hours ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {x < 24 ? `${x}+ hours` : `${x / 24}+ days`}
          </Link>
        ))}
      </nav>
      <SubTabs base="/admin/follow-up" tabs={TABS} active={tab} keep={{ hours: String(hours) }} />

      {tab === "orders" && <section className="mb-8 space-y-3">
        <h2 className="text-base font-semibold">Orders not paid ({orders.length})</h2>
        <p className="text-sm text-muted-foreground">Order placed, but no payment receipt submitted (or the receipt was rejected). Unpaid orders expire automatically at the payment deadline.</p>
        <Table scroll head={["Customer", "Order", "Total", "Status", "Waiting"]} empty="None.">
          {orders.map((r) => (
            <tr key={`o-${r.entity_id}`} className="align-top">
              <Td><Contact r={r} /></Td>
              <Td>{canOpenOrders ? <Link href={`/admin/orders/${r.entity_id}`} className="text-primary underline underline-offset-2">{r.reference}</Link> : r.reference}
                <span className="block text-xs text-muted-foreground">{r.item_count} item(s)</span></Td>
              <Td className="tabular-nums">{money(r.amount_etb)}</Td>
              <Td>{r.status && <StatusBadge kind="order" status={r.status} />}</Td>
              <Td className="tabular-nums">{waitingFor(r.since, now)}</Td>
            </tr>
          ))}
        </Table>
      </section>}

      {tab === "baskets" && <section className="mb-8 space-y-3">
        <h2 className="text-base font-semibold">Baskets not checked out ({baskets.length})</h2>
        <p className="text-sm text-muted-foreground">Signed-in customers with items in their basket who have not placed an order (last 30 days). Values use today’s prices.</p>
        <Table scroll head={["Customer", "Basket", "Value", "Waiting"]} empty="None.">
          {baskets.map((r) => {
            const items = Array.isArray(r.items) ? (r.items as { name: string; quantity: number }[]) : [];
            return (
              <tr key={`b-${r.user_id}`} className="align-top">
                <Td><Contact r={r} /></Td>
                <Td className="text-xs"><ul>{items.map((i, n) => <li key={n}>{i.quantity} × {i.name}</li>)}</ul></Td>
                <Td className="tabular-nums">{money(r.amount_etb)}</Td>
                <Td className="tabular-nums">{waitingFor(r.since, now)}</Td>
              </tr>
            );
          })}
        </Table>
      </section>}

      {tab === "printing" && <section className="space-y-3">
        <h2 className="text-base font-semibold">Printing jobs not paid ({printing.length})</h2>
        <p className="text-sm text-muted-foreground">Priced printing jobs that have not been added to an order and paid.</p>
        <Table scroll head={["Customer", "Job", "Price", "Waiting"]} empty="None.">
          {printing.map((r) => (
            <tr key={`p-${r.entity_id}`} className="align-top">
              <Td><Contact r={r} /></Td>
              <Td>{canOpenPrinting ? <Link href={`/admin/printing/${r.entity_id}`} className="text-primary underline underline-offset-2">{r.reference}</Link> : r.reference}</Td>
              <Td className="tabular-nums">{money(r.amount_etb)}</Td>
              <Td className="tabular-nums">{waitingFor(r.since, now)}</Td>
            </tr>
          ))}
        </Table>
      </section>}
    </>
  );
}
