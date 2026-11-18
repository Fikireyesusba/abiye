import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel, Table, Td } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
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
  const [{ data: c }, { data: orders }] = await Promise.all([
    supabase.from("customers").select("*, addresses(city, address_line, instructions, last_used_at)").eq("id", id).maybeSingle(),
    supabase.from("orders").select("id, order_number, total_etb, status, payment_status, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
  ]);
  if (!c) notFound();
  const verified = (orders ?? []).filter((o) => o.payment_status === "verified").reduce((s, o) => s + Number(o.total_etb), 0);
  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Customers</Link>
      <PageHeader title={c.full_name} description={`${formatEthiopianPhone(c.phone)} · customer since ${formatDateTime(c.created_at, "en")}`} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <Table head={["Order", "Total", "Status", "Payment", "Placed"]} empty="No orders.">
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
        <div className="space-y-6">
          {ctx.permissions.has("analytics.view") && <Panel title="Verified spend"><p className="text-2xl font-semibold">{formatETB(toSantim(verified))}</p></Panel>}
          <Panel title="Delivery addresses">
            <ul className="space-y-3 text-sm">
              {c.addresses.map((a, i) => <li key={i}><span className="font-medium">{a.city}</span> — {a.address_line}{a.instructions && <span className="block text-xs text-muted-foreground">{a.instructions}</span>}</li>)}
              {!c.addresses.length && <li className="text-muted-foreground">Pickup only.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
