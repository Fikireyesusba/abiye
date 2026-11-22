import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { recordCronRun } from "@/lib/security/events";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { deleteDuePrintingFiles } from "@/lib/printing/retention";

/**
 * Daily storage maintenance:
 *   1. deletes customer printing documents whose retention period has ended (jobs are kept);
 *   2. deletes customer uploads that were never attached to a payment or printing job
 *      (upload started, form abandoned) once they are older than a day.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getSupabaseAdmin();

  let deleted = 0;
  try {
    deleted = await deleteDuePrintingFiles(500);
  } catch (e) {
    console.error("[cron] printing retention failed:", (e as Error).message);
    await recordCronRun("storage-maintenance", false, { error: "retention failed" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  let orphans = 0;
  const { data: stale, error: orphanError } = await db.rpc("storage_orphans", { p_min_age: "1 day", p_limit: 500 });
  if (orphanError) {
    console.error("[cron] orphan query failed:", orphanError.message);
  } else {
    for (const bucket of ["payment-receipts", "printing-files"] as const) {
      const paths = (stale ?? []).filter((o) => o.bucket === bucket).map((o) => o.name);
      if (!paths.length) continue;
      const { error: rmError } = await db.storage.from(bucket).remove(paths);
      if (rmError) console.error(`[cron] orphan removal failed (${bucket}):`, rmError.message);
      else orphans += paths.length;
    }
  }
  // Security events older than 180 days are removed.
  const { data: purged } = await db.rpc("purge_security_events");
  // Telegram activity-feed messages never sent within 2 days (e.g. Telegram not set up) are dropped.
  await db.rpc("purge_stale_telegram_feed");
  await recordCronRun("storage-maintenance", true, { deleted, orphans, purged_events: purged ?? 0 });
  return NextResponse.json({ deleted, orphans, purged_events: purged ?? 0 });
}
