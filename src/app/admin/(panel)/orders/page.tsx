import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet } from "lucide-react";
import { PageHeader, Table, Td, fieldClass } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { ORDER_STATUSES } from "@/lib/admin/order-flow";
import { parseOrderSearch } from "@/lib/admin/search";
import { requirePermission } from "@/lib/auth/guards";
import { first, parsePage } from "@/lib/catalog/search";
import { formatDateTime, zoneToday } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Orders" };
/** An order shows here once the customer has paid (receipt waiting for approval, or verified). Unpaid checkouts: Stalled checkouts. */
// An order exists for staff only once its payment is accepted (payments waiting for approval are under Payments).
const PAID_PAYMENT = ["verified", "refunded"] as const;
const PAID_STATUSES = ORDER_STATUSES.filter((s) => !["awaiting_payment", "pending_verification", "payment_rejected", "expired"].includes(s));
const PAGE = 30;

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const ctx = await requirePermission("orders.view_all", "orders.view_assigned");
  const sp = await searchParams;
  const status = PAID_STATUSES.find((s) => s === first(sp.status)) ?? null;
  const search = parseOrderSearch(first(sp.q));
  const page = parsePage(first(sp.page));

  const today = zoneToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select("id, order_number, customer_name, customer_phone, fulfillment_method, city, total_etb, status, payment_status, created_at, assigned_to, channel", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  // Searching by number / phone also finds unpaid checkouts (e.g. a customer calling about one).
  if (!search) query = query.in("payment_status", [...PAID_PAYMENT]);
  if (status) query = query.eq("status", status);
  if (search?.kind === "number") query = query.eq("order_number", search.value);
  if (search?.kind === "phone") query = query.eq("customer_phone", search.value);
  if (search?.kind === "name") query = query.ilike("customer_name", `%${search.value}%`);
  const { data: orders, count, error } = await query;
  if (error) throw new Error("Could not load orders");
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (status) u.set("status", status);
    if (first(sp.q)) u.set("q", first(sp.q)!);
    u.set("page", String(p));
    return `/admin/orders?${u}`;
  };

  return (
    <>
      <PageHeader
        title="Orders"
        description={`${ctx.permissions.has("orders.view_all") ? `${count ?? 0} orders` : `${count ?? 0} orders assigned to you`} · an order appears here once the customer has paid (receipt waiting for approval, or verified). Unpaid checkouts are under Stalled checkouts.`}
      />
      {ctx.permissions.has("orders.view_all") && ctx.role === "super_admin" && (
        <details className="mb-4 rounded-lg border bg-card p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><FileSpreadsheet className="size-4 text-primary" aria-hidden /> Export to Excel</summary>
          <form method="get" action="/admin/orders/export" className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">From<input type="date" name="from" required defaultValue={monthStart} max={today} className={`${fieldClass} mt-1 block`} /></label>
            <label className="text-sm">To<input type="date" name="to" required defaultValue={today} max={today} className={`${fieldClass} mt-1 block`} /></label>
            <label className="text-sm">Orders
              <select name="status" defaultValue="all" className={`${fieldClass} mt-1 block w-auto`}>
                <option value="all">All orders</option>
                <option value="paid">Paid (verified) only</option>
                {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <Button type="submit"><Download /> Download .xlsx</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Sheets: Summary, Orders (one row per order) and Items. Dates in Warsaw time. The file contains customer phone numbers and addresses — store it safely. Each export is recorded in the Activity log.</p>
        </details>
      )}
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={first(sp.q)} placeholder="Order number, phone or name" maxLength={40} className={`${fieldClass} max-w-xs`} aria-label="Search orders" />
        <select name="status" defaultValue={status ?? ""} className={`${fieldClass} w-auto`} aria-label="Filter by status">
          <option value="">All statuses</option>
          {PAID_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select>
        <Button type="submit" variant="outline">Filter</Button>
        {(status || search) && <Button variant="ghost" asChild><Link href="/admin/orders">Clear</Link></Button>}
      </form>
      <Table scroll head={["Order", "Customer", "Fulfillment", "Total", "Status", "Payment", "Placed"]} empty="No orders match.">
        {orders.map((o) => (
          <tr key={o.id} className="hover:bg-muted/40">
            <Td><Link href={`/admin/orders/${o.id}`} className="font-medium text-primary hover:underline">{o.order_number}</Link>
              {o.channel === "in_store" && <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium">In store</span>}</Td>
            <Td>
              <span className="block">{o.customer_name}</span>
              <span className="block text-xs text-muted-foreground">{formatEthiopianPhone(o.customer_phone)}</span>
            </Td>
            <Td>{o.channel === "in_store" ? "Sold at the shop" : o.fulfillment_method === "pickup" ? "Pickup" : `Delivery · ${o.city}`}</Td>
            <Td className="tabular-nums">{formatETB(toSantim(o.total_etb))}</Td>
            <Td><StatusBadge kind="order" status={o.status} /></Td>
            <Td><StatusBadge kind="payment" status={o.payment_status} /></Td>
            <Td className="text-xs text-muted-foreground">{formatDateTime(o.created_at, "en")}</Td>
          </tr>
        ))}
      </Table>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 && <Link href={qs(page - 1)} className="text-primary hover:underline">Previous</Link>}
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          {page < pages && <Link href={qs(page + 1)} className="text-primary hover:underline">Next</Link>}
        </nav>
      )}
    </>
  );
}
