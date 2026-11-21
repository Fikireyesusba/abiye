"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchReceiptArchive } from "@/lib/email/archive";
import { dispatchCustomerEmails } from "@/lib/email/dispatch";
import { dispatchCustomerPush } from "@/lib/push/dispatch";
import { dispatchGroup, dispatchNotifications, groupConfig, securityTelegramConfig, telegramConfig } from "@/lib/telegram/dispatch";
import { dbError, fail, ok, type ActionResult } from "./result";

export async function sendTestNotification(): Promise<ActionResult> {
  await requirePermission("settings.manage");
  if (!telegramConfig()) return fail("The orders & payments group is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID).");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_queue_test_notification");
  if (error) return dbError(error);
  const r = await dispatchGroup(false, 20); // send now so the admin sees the result immediately
  revalidatePath("/admin/notifications");
  return r.failed ? fail("Test message could not be delivered — see the error below.") : ok("Test message sent to the orders & payments group.");
}

export async function sendSecurityTest(): Promise<ActionResult> {
  await requirePermission("settings.manage");
  if (!securityTelegramConfig()) return fail("The security group is not configured (TELEGRAM_SECURITY_BOT_TOKEN / TELEGRAM_SECURITY_CHAT_ID).");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_queue_security_test");
  if (error) return dbError(error);
  const r = await dispatchGroup(true, 20);
  revalidatePath("/admin/notifications");
  return r.failed ? fail("Test message could not be delivered — see the error below.") : ok("Test message sent to the security group.");
}

export async function retryNotification(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const id = z.coerce.number().int().positive().safeParse(fd.get("id"));
  if (!id.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_retry_notification", { p_id: id.data });
  if (error) return dbError(error);
  // Re-send through whichever channel the message belongs to.
  const results = await Promise.allSettled([dispatchNotifications(20), dispatchCustomerEmails(20), dispatchCustomerPush(20), dispatchReceiptArchive(10)]);
  const failed = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.failed : 1), 0);
  revalidatePath("/admin/notifications");
  return failed ? fail("Still failing — see the error below.") : ok("Message re-sent.");
}

/** Super Admin: which activity reaches the staff Telegram chat. */
export async function saveTelegramFeed(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_telegram_feed", {
    p_security: fd.get("security") === "on", p_admin: fd.get("admin") === "on", p_notifications: fd.get("notifications") === "on",
    p_order_progress: fd.get("order_progress") === "on", p_printing_requests: fd.get("printing_requests") === "on",
  });
  if (error) return dbError(error);
  revalidatePath("/admin/notifications");
  return ok("Telegram activity feed saved.");
}

/** Retry every failed message at once (customer messages and both Telegram groups). */
export async function retryAllFailed(): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_notifications", { p_limit: 1000 });
  if (error) return dbError(error);
  const ids = (data ?? []).filter((r) => r.status === "failed" || (r.status === "dead" && !r.last_error?.startsWith("skipped"))).map((r) => r.id).slice(0, 200);
  if (!ids.length) return ok("Nothing to retry.");
  let queued = 0;
  for (const id of ids) {
    const { error: e } = await supabase.rpc("admin_retry_notification", { p_id: id });
    if (!e) queued++;
  }
  const results = await Promise.allSettled([dispatchNotifications(50), dispatchCustomerEmails(50), dispatchCustomerPush(50), dispatchReceiptArchive(20)]);
  const failed = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.failed : 0), 0);
  revalidatePath("/admin/notifications");
  revalidatePath("/admin", "layout");
  return failed ? fail(`${queued} message(s) retried — ${failed} still failing. See the error next to each.`) : ok(`${queued} message(s) retried and sent.`);
}

/** Test message for the stock or receipts group. */
export async function sendGroupTest(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const raw = fd.get("group");
  const group = raw === "stock" || raw === "receipts" || raw === "printing" ? raw : null;
  if (!group) return fail("Invalid request.");
  if (!groupConfig(group)) {
    const v = group.toUpperCase();
    return fail(`The ${group} group is not configured (TELEGRAM_${v}_BOT_TOKEN / TELEGRAM_${v}_CHAT_ID).`);
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_queue_group_test", { p_group: group });
  if (error) return dbError(error);
  const r = await dispatchGroup(group, 20);
  revalidatePath("/admin/notifications");
  return r.failed ? fail("Test message could not be delivered — see the error below.") : ok(`Test message sent to the ${group} group.`);
}

/**
 * Remove sent / failed notifications of a date range (Warsaw days, inclusive) — only after this admin
 * downloaded their Excel export in the last 30 minutes (checked by the database). Waiting messages are kept.
 */
export async function clearNotifications(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("settings.manage");
  const from = String(fd.get("from") ?? "");
  const to = String(fd.get("to") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return fail("Choose the dates (from ≤ to).");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_clear_notifications", { p_from: from, p_to: to });
  if (error) {
    if (error.message === "invalid_request") return fail("Download the Excel export of these dates first (same or wider dates), then clear within 30 minutes.");
    return dbError(error);
  }
  revalidatePath("/admin/notifications");
  return ok(`Cleared ${data} notification${data === 1 ? "" : "s"} from ${from} to ${to}. Messages still waiting were kept.`);
}
