import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { ReceiptPreview } from "@/components/admin/receipt-preview";
import { PageHeader, Panel, SubTabs, fieldClass, pickTab } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { nextStatuses, type OrderStatus } from "@/lib/admin/order-flow";
import { addOrderNote, assignOrder, reviewPayment, updateOrderStatus } from "@/lib/admin/order-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { isGuid } from "@/lib/orders/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Order" };
const etb = (n: number) => formatETB(toSantim(n));
const STATUS_LABEL: Record<string, string> = {
  processing: "Start processing", ready_for_pickup: "Mark ready for pickup", out_for_delivery: "Mark out for delivery",
  completed: "Mark completed", cancelled: "Cancel order",
};

export default async function OrderDetailPage({ params, searchParams }: PageProps<"/admin/orders/[id]">) {
  const ctx = await requirePermission("orders.view_all", "orders.view_assigned");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createSupabaseServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select(`*, items:order_items(*), history:order_status_history(*), notes:order_notes(*)`)
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound(); // RLS: also not found when not visible to this role

  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const [{ data: submissions }, { data: staff }] = await Promise.all([
    can("payments.view")
      ? supabase.from("payment_submissions").select("*").eq("order_id", id).order("submitted_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    can("orders.manage")
      ? supabase.from("profiles").select("id, full_name, is_active").eq("is_active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; is_active: boolean }[] }),
  ]);
  const signed = await Promise.all(
    (submissions ?? []).map(async (s) => (await supabase.storage.from("payment-receipts").createSignedUrl(s.receipt_path, 300)).data?.signedUrl ?? null),
  );

  const history = [...order.history].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const notes = [...order.notes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const staffName = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const transitions = nextStatuses(order.status as OrderStatus, order.fulfillment_method).filter(
    (s) => s !== "cancelled" || can("orders.manage"),
  );
  const canFulfil = can("orders.manage") || can("orders.update_fulfillment");
  const bank = order.bank_snapshot as Record<string, string | null>;

  const sp = await searchParams;
  const TABS = [
    { key: "items", label: "Items" },
    ...(can("payments.view") ? [{ key: "payment", label: "Payment", count: submissions?.filter((x) => x.status === "pending").length }] : []),
    { key: "history", label: "History & notes", count: history.length + notes.length },
  ];
  // Opens on the payment when a receipt is waiting for approval.
  const tab = sp.tab ? pickTab(TABS, sp.tab) : submissions?.some((x) => x.status === "pending") && can("payments.view") ? "payment" : "items";

  return (
    <>
      <Link href="/admin/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <PageHeader
        title={order.order_number}
        description={`Placed ${formatDateTime(order.created_at, "en")} · ${order.locale === "am" ? "Amharic" : "English"} customer`}
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">Order <StatusBadge kind="order" status={order.status} /></span>
            <span className="flex items-center gap-1.5">Payment <StatusBadge kind="payment" status={order.payment_status} /></span>
          </div>
        }
      />

      <SubTabs base={`/admin/orders/${order.id}`} tabs={TABS} active={tab} />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {tab === "payment" && can("payments.view") && (
            <Panel title="Payment evidence">
              {!submissions?.length ? (
                <p className="text-sm text-muted-foreground">No payment submitted yet. Payment due {formatDateTime(order.payment_due_at, "en")}.</p>
              ) : (
                <ul className="space-y-5">
                  {submissions.map((s, i) => (
                    <li key={s.id} className="grid gap-4 border-b pb-5 last:border-0 last:pb-0 md:grid-cols-[14rem_1fr]">
                      <ReceiptPreview url={signed[i]} mime={s.receipt_mime} />
                      <div className="space-y-2 text-sm">
                        <p><span className="text-muted-foreground">Submitted:</span> {formatDateTime(s.submitted_at, "en")}</p>
                        <p><span className="text-muted-foreground">Reference:</span> <span className="font-mono">{s.transaction_reference ?? "—"}</span></p>
                        <p><span className="text-muted-foreground">Expected amount:</span> <strong>{etb(s.amount_expected_etb)}</strong> to {bank.bank_name} · {bank.account_number}</p>
                        <p><span className="text-muted-foreground">Status:</span> <span className="font-medium capitalize">{s.status}</span>
                          {s.reviewed_at && <span className="text-muted-foreground"> · {formatDateTime(s.reviewed_at, "en")}</span>}</p>
                        {s.review_note && <p><span className="text-muted-foreground">Note:</span> {s.review_note}</p>}
                        {s.status === "pending" && can("payments.verify") && (
                          <div className="grid gap-3 pt-2 sm:grid-cols-2">
                            <ActionForm action={reviewPayment} hidden={{ submissionId: s.id, decision: "verified" }}
                              submitLabel="Verify payment" confirm={`Confirm you have seen ${etb(s.amount_expected_etb)} arrive in the ${bank.bank_name} account?`} />
                            <ActionForm action={reviewPayment} hidden={{ submissionId: s.id, decision: "rejected" }} submitLabel="Reject" variant="outline">
                              <Textarea name="note" required maxLength={1000} rows={2} placeholder="Reason shown to the customer" aria-label="Rejection reason" />
                            </ActionForm>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {tab === "items" && <Panel title="Items" scroll>
            <ul className="divide-y text-sm">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 py-2">
                  <span>{i.name_en} <span className="text-muted-foreground">· {i.sku} × {i.quantity}</span></span>
                  <span className="tabular-nums">{etb(i.line_total_etb)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{etb(order.subtotal_etb)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Delivery</dt><dd>{etb(order.delivery_fee_etb)}</dd></div>
              {Number(order.discount_etb) > 0 && <div className="flex justify-between text-success"><dt>Promo discount</dt><dd>−{etb(order.discount_etb)}</dd></div>}
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{etb(order.total_etb)}</dd></div>
            </dl>
          </Panel>}

          {tab === "history" && <Panel title="History & internal notes">
            <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
            <ol className="space-y-2 border-l pl-4 text-sm">
              {[...history.map((h) => ({ at: h.created_at, kind: "status" as const, h })), ...notes.map((n) => ({ at: n.created_at, kind: "note" as const, n }))]
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((e, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full ${e.kind === "note" ? "bg-accent" : "bg-primary"}`} aria-hidden />
                    {e.kind === "status" ? (
                      <><span className="font-medium">{e.h.to_status.replaceAll("_", " ")}</span>
                        {e.h.note && <span> — {e.h.note}</span>}</>
                    ) : (
                      <><span className="font-medium">Note</span> ({staffName.get(e.n.author_id) ?? "staff"}): {e.n.body}</>
                    )}
                    <span className="text-muted-foreground"> · {formatDateTime(e.at, "en")}</span>
                  </li>
                ))}
            </ol>
            </div>
            {canFulfil && (
              <ActionForm action={addOrderNote} hidden={{ orderId: order.id }} submitLabel="Add note" variant="outline" size="sm" resetOnSuccess className="mt-4">
                <Textarea name="body" required maxLength={2000} rows={2} placeholder="Internal note (not visible to the customer)" aria-label="Internal note" />
              </ActionForm>
            )}
          </Panel>}
        </div>

        <div className="space-y-6">
          {canFulfil && transitions.length > 0 && (
            <Panel title="Update status">
              <div className="space-y-3">
                {transitions.filter((s) => s !== "cancelled").map((s) => (
                  <ActionForm key={s} action={updateOrderStatus} hidden={{ orderId: order.id, status: s }} submitLabel={STATUS_LABEL[s] ?? s} className="[&_button]:w-full" />
                ))}
                {transitions.includes("cancelled") && (
                  <ActionForm action={updateOrderStatus} hidden={{ orderId: order.id, status: "cancelled" }} submitLabel="Cancel order"
                    variant="destructive" confirm={order.payment_status === "verified" ? "This order is PAID. Cancelling requires a manual refund. Continue?" : "Cancel this order and release its stock?"}
                    className={`${transitions.length > 1 ? "border-t pt-3" : ""} [&_button]:w-full`}>
                    <Textarea name="note" required rows={2} maxLength={1000} placeholder="Reason for cancelling" aria-label="Cancellation reason" />
                  </ActionForm>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Customer">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{order.customer_name}</dd></div>
              <div><dt className="text-muted-foreground">Phone</dt><dd><a href={`tel:${order.customer_phone}`} className="text-primary">{formatEthiopianPhone(order.customer_phone)}</a></dd></div>
              <div><dt className="text-muted-foreground">Fulfillment</dt><dd>{order.fulfillment_method === "pickup" ? "Pickup at shop" : `Delivery · ${order.city}`}</dd></div>
              {order.address_line && <div><dt className="text-muted-foreground">Address</dt><dd>{order.address_line}</dd></div>}
              {order.delivery_instructions && <div><dt className="text-muted-foreground">Instructions</dt><dd>{order.delivery_instructions}</dd></div>}
              {can("customers.view") && order.user_id && <Link href={`/admin/customers/${order.user_id}`} className="inline-block pt-1 text-primary hover:underline">Customer account & history →</Link>}
            </dl>
          </Panel>

          {can("orders.manage") && (
            <Panel title="Assigned staff">
              <ActionForm action={assignOrder} hidden={{ orderId: order.id }} submitLabel="Save assignment" variant="outline" size="sm">
                <select name="assignee" defaultValue={order.assigned_to ?? ""} className={fieldClass} aria-label="Assign to">
                  <option value="">Unassigned</option>
                  {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
