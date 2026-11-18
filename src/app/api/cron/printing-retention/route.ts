import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Deletes customer printing documents whose retention period has ended (never jobs in production). */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getSupabaseAdmin();
  const { data: due, error } = await db.rpc("printing_files_due_for_deletion", { p_limit: 500 });
  if (error) {
    console.error("[cron] printing retention query failed:", error.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  if (!due?.length) return NextResponse.json({ deleted: 0 });
  const { error: removeError } = await db.storage.from("printing-files").remove(due.map((f) => f.storage_path));
  if (removeError) {
    console.error("[cron] printing retention storage removal failed:", removeError.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  const { data: marked, error: markError } = await db.rpc("mark_printing_files_deleted", { p_file_ids: due.map((f) => f.file_id) });
  if (markError) return NextResponse.json({ error: "failed" }, { status: 500 });
  return NextResponse.json({ deleted: marked });
}
