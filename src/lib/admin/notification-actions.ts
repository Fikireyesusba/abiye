"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchReceiptArchive } from "@/lib/email/archive";
import { dispatchCustomerEmails } from "@/lib/email/dispatch";
import { dispatchCustomerPush } from "@/lib/push/dispatch";
import { dispatchNotifications, telegramConfig } from "@/lib/telegram/dispatch";
import { dbError, fail, ok, type ActionResult } from "./result";

export async function sendTestNotification(): Promise<ActionResult> {
  await requirePermission("settings.manage");
  if (!telegramConfig()) return fail("Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID).");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_queue_test_notification");
  if (error) return dbError(error);
  const r = await dispatchNotifications(20); // send now so the admin sees the result immediately
  revalidatePath("/admin/notifications");
  return r.failed ? fail("Test message could not be delivered — see the error below.") : ok("Test message sent to Telegram.");
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
