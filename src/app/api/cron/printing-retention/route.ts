import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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
  const { data: due, error } = await db.rpc("printing_files_due_for_deletion", { p_limit: 500 });
  if (error) {
    console.error("[cron] printing retention query failed:", error.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  if (due?.length) {
    const { error: removeError } = await db.storage.from("printing-files").remove(due.map((f) => f.storage_path));
    if (removeError) {
      console.error("[cron] printing retention storage removal failed:", removeError.message);
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    const { data: marked, error: markError } = await db.rpc("mark_printing_files_deleted", { p_file_ids: due.map((f) => f.file_id) });
    if (markError) return NextResponse.json({ error: "failed" }, { status: 500 });
    deleted = Number(marked ?? 0);
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
  return NextResponse.json({ deleted, orphans });
}
