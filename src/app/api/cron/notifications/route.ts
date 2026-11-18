import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { dispatchNotifications } from "@/lib/telegram/dispatch";

export const maxDuration = 60;

/**
 * Safety net for Telegram alerts: retries failed sends and delivers anything
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
  return NextResponse.json({ configured, sent, failed });
}
