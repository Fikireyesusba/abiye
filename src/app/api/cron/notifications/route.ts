import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { dispatchCustomerEmails } from "@/lib/email/dispatch";
import { recordCronRun } from "@/lib/security/events";
import { dispatchCustomerPush } from "@/lib/push/dispatch";
import { dispatchNotifications } from "@/lib/telegram/dispatch";

export const maxDuration = 60;

/**
 * Safety net for Telegram alerts and customer emails: retries failed sends and delivers anything
 * queued while Telegram was unreachable. (New events are also sent immediately
 * after the request that created them.)
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let sent = 0;
  let failed = 0;
  let configured = true;
  for (let round = 0; round < 5; round++) {
    const r = await dispatchNotifications(20);
    configured = r.configured;
    sent += r.sent;
    failed += r.failed;
    if (!r.configured || r.sent + r.failed < 20) break;
  }
  const emails = { configured: true, sent: 0, failed: 0 };
  for (let round = 0; round < 5; round++) {
    const r = await dispatchCustomerEmails(20);
    emails.configured = r.configured;
    emails.sent += r.sent;
    emails.failed += r.failed;
    if (!r.configured || r.sent + r.failed < 20) break;
  }
  const push = { configured: true, sent: 0, failed: 0 };
  for (let round = 0; round < 5; round++) {
    const r = await dispatchCustomerPush(20);
    push.configured = r.configured;
    push.sent += r.sent;
    push.failed += r.failed;
    if (!r.configured || r.sent + r.failed < 20) break;
  }
  await recordCronRun("notifications", true, { telegram: { configured, sent, failed }, emails, push });
  return NextResponse.json({ configured, sent, failed, emails, push });
}
