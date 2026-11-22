"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { ORDER_STATUSES } from "./order-flow";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const guid = z.guid();
const note = z.string().trim().max(1000).optional().transform((v) => v || undefined);

export async function reviewPayment(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("payments.verify");
  const parsed = z
    .object({ submissionId: guid, decision: z.enum(["verified", "rejected"]), note, orderId: guid.optional() })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const { submissionId, decision, note: reason } = parsed.data;
  if (decision === "rejected" && !reason) return fail("Please enter the reason for rejecting this payment (the customer will see it).");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_review_payment", { p_submission_id: submissionId, p_decision: decision, p_note: reason });
  if (error) return dbError(error);
  dispatchSoon();
  revalidatePath("/admin", "layout");
  if (decision === "verified") return ok("Payment verified — order confirmed.");
  // An order with printing is cancelled on rejection and its documents are deleted (they stay in Telegram).
  const { data: sub } = await supabase.from("payment_submissions").select("order:orders(status)").eq("id", submissionId).maybeSingle();
  const cancelled = (sub?.order as { status?: string } | null)?.status === "cancelled";
  return ok(cancelled ? "Payment rejected — the order had printing, so it was cancelled and the documents were deleted from storage (they stay in Telegram)." : "Payment rejected — customer can resubmit.");
}

export async function updateOrderStatus(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("orders.manage", "orders.update_fulfillment");
  const parsed = z.object({ orderId: guid, status: z.enum(ORDER_STATUSES), note }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const { orderId, status, note: n } = parsed.data;
  if (status === "cancelled" && !n) return fail("Please enter the reason for cancelling.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_order_status", { p_order_id: orderId, p_status: status, p_note: n });
  if (error) return dbError(error);
  dispatchSoon(); // staff alert on cancellation + customer email for status changes
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return ok("Order status updated.");
}

export async function assignOrder(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("orders.manage");
  const parsed = z.object({ orderId: guid, assignee: z.union([guid, z.literal("")]) }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_assign_order", {
    p_order_id: parsed.data.orderId,
    p_assignee: (parsed.data.assignee || null) as string,
  });
  if (error) return dbError(error);
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return ok(parsed.data.assignee ? "Order assigned." : "Assignment removed.");
}

export async function addOrderNote(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("orders.manage", "orders.update_fulfillment");
  const parsed = z.object({ orderId: guid, body: z.string().trim().min(1).max(2000) }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Write a note first (max 2000 characters).");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("order_notes").insert({ order_id: parsed.data.orderId, body: parsed.data.body });
  if (error) return dbError(error);
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return ok("Note added.");
}
