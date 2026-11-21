"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, ok, type ActionResult } from "./result";
import { zoneToday } from "@/lib/datetime";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Super Admin: remove activity entries of any date range (Warsaw days, inclusive) — only after this admin
 * downloaded the Excel export of (at least) the same days in the last 30 minutes (checked by the database).
 * The clearing itself and the export records are always kept.
 */
export async function clearActivityLog(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("audit.manage");
  const from = String(fd.get("from") ?? "");
  const to = String(fd.get("to") ?? "");
  if (!DAY.test(from) || !DAY.test(to) || to < from || to > zoneToday()) return fail("Choose the dates (from ≤ to, not in the future).");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_clear_audit_range", { p_from: from, p_to: to });
  if (error) {
    if (error.message === "invalid_request") return fail(EXPORT_FIRST);
    return dbError(error);
  }
  revalidatePath("/admin/activity");
  return ok(`Cleared ${data} entr${data === 1 ? "y" : "ies"} from ${from} to ${to}. The clearing is recorded in the log.`);
}

const EXPORT_FIRST = "Download the Excel export of these dates first (Export to Excel, same or wider dates, “All areas”), then clear within 30 minutes.";
