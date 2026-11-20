"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, ok, type ActionResult } from "./result";

/** Super Admin: remove activity entries created before a date (at least 30 days ago). The clearing is recorded permanently. */
export async function clearActivityLog(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("audit.manage");
  const before = String(fd.get("before") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return fail("Choose a date.");
  if (fd.get("exported") !== "on") return fail("Download the Excel export first, then tick the box.");
  const cutoff = new Date(Date.parse(`${before}T00:00:00+03:00`));
  if (cutoff.getTime() > new Date().getTime() - 30 * 86400000) return fail("The last 30 days are always kept. Choose an earlier date.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_clear_audit_logs", { p_before: cutoff.toISOString() });
  if (error) return dbError(error);
  revalidatePath("/admin/activity");
  return ok(`Cleared ${data} entr${data === 1 ? "y" : "ies"} from before ${before}. This clearing is recorded in the log.`);
}
