"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCustomerUser } from "@/lib/account/session";
import { toAppError, type AppErrorCode } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { ORDER_REQUIRED, TICKET_TOPICS } from "./topics";


export type TicketState = { error?: AppErrorCode; field?: "topic" | "orderNumber" | "subject" | "details"; ticketId?: string; ticketNumber?: string; submitted?: number };

const ticketInput = z.object({
  topic: z.enum(TICKET_TOPICS),
  orderNumber: z.string().trim().max(20).optional().transform((v) => v || undefined),
  subject: z.string().trim().max(120).optional().transform((v) => v || undefined),
  details: z.string().trim().min(10).max(3000),
});

/** Signed-in customer opens a support ticket (checked again by the database). */
export async function createTicket(_prev: TicketState, fd: FormData): Promise<TicketState> {
  const submitted = Date.now();
  const user = await getCustomerUser();
  if (!user) return { error: "login_required", submitted };
  const parsed = ticketInput.safeParse({
    topic: fd.get("topic"), orderNumber: fd.get("orderNumber") ?? undefined, subject: fd.get("subject") ?? undefined, details: fd.get("details"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: "invalid_request", field: field === "topic" || field === "details" || field === "subject" ? field : undefined, submitted };
  }
  const d = parsed.data;
  if (d.topic === "other" && (!d.subject || d.subject.length < 3)) return { error: "invalid_request", field: "subject", submitted };
  if (ORDER_REQUIRED.includes(d.topic) && !d.orderNumber) return { error: "order_not_found", field: "orderNumber", submitted };
  if (!(await rateLimit(`ticket:${user.id}`, 10, 3600))) return { error: "rate_limited", submitted };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("customer_create_ticket", {
    p_category: d.topic, p_order_number: d.orderNumber ?? "", p_subject: d.subject ?? "", p_details: d.details,
  });
  if (error) {
    const code = toAppError(error).code;
    return { error: code, field: code === "order_not_found" ? "orderNumber" : undefined, submitted };
  }
  const r = data as { ticket_id: string; ticket_number: string };
  dispatchSoon(); // to the support Telegram group
  revalidatePath("/support");
  return { ticketId: r.ticket_id, ticketNumber: r.ticket_number, submitted };
}

export type ReplyState = { error?: AppErrorCode; ok?: boolean; submitted?: number };

export async function replyTicket(_prev: ReplyState, fd: FormData): Promise<ReplyState> {
  const submitted = Date.now();
  const user = await getCustomerUser();
  if (!user) return { error: "login_required", submitted };
  const parsed = z.object({ ticketId: z.guid(), body: z.string().trim().min(1).max(3000) }).safeParse({ ticketId: fd.get("ticketId"), body: fd.get("body") });
  if (!parsed.success) return { error: "invalid_request", submitted };
  if (!(await rateLimit(`ticket-reply:${user.id}`, 30, 3600))) return { error: "rate_limited", submitted };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("customer_reply_ticket", { p_ticket_id: parsed.data.ticketId, p_body: parsed.data.body });
  if (error) return { error: toAppError(error).code, submitted };
  dispatchSoon();
  revalidatePath(`/support/${parsed.data.ticketId}`);
  return { ok: true, submitted };
}
