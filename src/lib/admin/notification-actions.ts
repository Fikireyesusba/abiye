"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchReceiptArchive } from "@/lib/email/archive";
import { dispatchCustomerEmails } from "@/lib/email/dispatch";
import { dispatchCustomerPush } from "@/lib/push/dispatch";
import { dispatchGroup, dispatchNotifications, securityTelegramConfig, telegramConfig } from "@/lib/telegram/dispatch";
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
  });
  if (error) return dbError(error);
  revalidatePath("/admin/notifications");
  return ok("Telegram activity feed saved.");
}
