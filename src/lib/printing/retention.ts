import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Deletes printing documents that are due (retention ended, job cancelled or payment rejected)
 * from storage and marks them deleted. A document is only due once its copy reached the
 * printing Telegram group (or could not be sent within 2 days). Returns how many were deleted.
 */
export async function deleteDuePrintingFiles(limit = 500): Promise<number> {
  const db = getSupabaseAdmin();
  const { data: due, error } = await db.rpc("printing_files_due_for_deletion", { p_limit: limit });
  if (error) throw new Error(`retention query failed: ${error.message}`);
  if (!due?.length) return 0;
  const { error: removeError } = await db.storage.from("printing-files").remove(due.map((f) => f.storage_path));
  if (removeError) throw new Error(`storage removal failed: ${removeError.message}`);
  const { data: marked, error: markError } = await db.rpc("mark_printing_files_deleted", { p_file_ids: due.map((f) => f.file_id) });
  if (markError) throw new Error(`mark deleted failed: ${markError.message}`);
  return Number(marked ?? 0);
}

/** Same, without failing the caller (used right after a payment rejection / cancellation and after Telegram sends). */
export async function deleteDuePrintingFilesQuietly(): Promise<void> {
  try {
    await deleteDuePrintingFiles(200);
  } catch (e) {
    console.error("[printing] file clean-up failed:", (e as Error).message);
  }
}
