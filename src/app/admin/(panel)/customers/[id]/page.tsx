import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel, Table, Td } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { Badge } from "@/components/ui/badge";
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
  const [{ data: rows }, { data: orders }] = await Promise.all([
    supabase.rpc("admin_customer_accounts", { p_user_id: id, p_limit: 1 }),
    supabase.from("orders").select("id, order_number, total_etb, status, payment_status, fulfillment_method, city, address_line, created_at")
      .eq("user_id", id).order("created_at", { ascending: false }),
  ]);
  const c = rows?.[0];
  if (!c) notFound();
  const verified = (orders ?? []).filter((o) => o.payment_status === "verified").reduce((s, o) => s + Number(o.total_etb), 0);
  const addresses = [...new Set((orders ?? []).filter((o) => o.address_line).map((o) => `${o.city} — ${o.address_line}`))];

  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Customers</Link>
      <PageHeader title={c.full_name || c.email} description={`${c.email} · joined ${formatDateTime(c.created_at, "en")}`}
        actions={c.email_confirmed_at ? <Badge variant="success">Email confirmed</Badge> : <Badge variant="warning">Email not confirmed</Badge>} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
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
        <div className="space-y-6">
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
