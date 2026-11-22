import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { dispatchCustomerEmails } from "@/lib/email/dispatch";
import { recordCronRun } from "@/lib/security/events";
import { dispatchCustomerPush } from "@/lib/push/dispatch";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Expires unpaid orders past their payment window and releases reserved stock. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin().rpc("expire_unpaid_orders");
  if (error) {
    console.error("[cron] expire_unpaid_orders failed:", error.message);
    await recordCronRun("expire-orders", false, { error: "expire failed" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  // Customer emails for the expired orders.
  const emails = Number(data) > 0 ? await dispatchCustomerEmails(50) : null;
  const push = Number(data) > 0 ? await dispatchCustomerPush(50) : null;
  // Support tickets waiting 48 h for the customer's answer are closed (also done when the support pages open).
  const { data: closed } = await getSupabaseAdmin().rpc("close_stale_tickets");
  await recordCronRun("expire-orders", true, { expired: data, tickets_closed: closed ?? 0 });
  return NextResponse.json({ expired: data, emails, push, tickets_closed: closed ?? 0 });
}
