"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TICKET_STATUSES } from "@/lib/support/topics";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { dbError, fail, ok, type ActionResult } from "./result";

/** Staff: change status / assignee and/or write to the customer (or an internal note). */
export async function updateTicket(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("support.manage");
  const parsed = z.object({
    ticketId: z.guid(),
    status: z.enum(TICKET_STATUSES).optional(),
    assignee: z.union([z.guid(), z.literal("none"), z.literal("")]).optional(),
    message: z.string().trim().max(3000).optional(),
    internal: z.boolean(),
  }).safeParse({
    ticketId: fd.get("ticketId"), status: fd.get("status") || undefined, assignee: fd.get("assignee") ?? undefined,
    message: fd.get("message") ?? undefined, internal: fd.get("internal") === "on",
  });
  if (!parsed.success) return fail("Invalid request.");
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_ticket", {
    p_ticket_id: d.ticketId, p_status: d.status, p_assigned_to: d.assignee && d.assignee !== "none" ? d.assignee : undefined,
    p_unassign: d.assignee === "none", p_message: d.message || undefined, p_internal: d.internal,
  });
  if (error) return dbError(error);
  dispatchSoon(); // email + phone notification to the customer
  revalidatePath(`/admin/support/${d.ticketId}`);
  revalidatePath("/admin", "layout");
  return ok(d.message ? (d.internal ? "Internal note saved." : "Reply sent to the customer.") : "Ticket updated.");
}

/** Delete closed / resolved tickets opened in a date range — only after they were exported (checked by the database). */
export async function clearTickets(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("support.manage");
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(fd.get("from") ?? ""), to = String(fd.get("to") ?? "");
  if (!day.test(from) || !day.test(to) || to < from) return fail("Choose a valid date range.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_clear_tickets", { p_from: from, p_to: to });
  if (error) return error.message === "invalid_request"
    ? fail("Download the Support tickets Excel export of these dates first (same or wider dates), then clear within 30 minutes.") : dbError(error);
  revalidatePath("/admin/support");
  revalidatePath("/admin/exports");
  return ok(`Cleared ${data ?? 0} closed ticket(s).`);
}
