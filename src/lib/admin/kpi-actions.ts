"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { KPI_METRICS } from "./kpi";
import { dbError, fail, ok, type ActionResult } from "./result";

const METRICS = KPI_METRICS.map((m) => m.key) as [string, ...string[]];

/** Super Admin: set (or change) a KPI target — for everyone, or for one staff member. */
export async function saveKpiTarget(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("kpi.manage");
  const parsed = z.object({
    metric: z.enum(METRICS), period: z.enum(["day", "week", "month"]), target: z.coerce.number().min(0).max(1000000),
    profileId: z.union([z.guid(), z.literal("")]),
  }).safeParse({ metric: fd.get("metric"), period: fd.get("period") ?? "month", target: fd.get("target"), profileId: fd.get("profileId") ?? "" });
  if (!parsed.success) return fail("Choose a KPI and enter a target (a number, 0 or more).");
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_save_kpi_target", { p_metric: d.metric, p_period: d.period, p_target: d.target, p_profile_id: d.profileId || undefined });
  if (error) return dbError(error);
  revalidatePath("/admin/performance");
  return ok("Target saved.");
}

export async function deleteKpiTarget(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("kpi.manage");
  const id = z.guid().safeParse(fd.get("id"));
  if (!id.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_delete_kpi_target", { p_id: id.data });
  if (error) return dbError(error);
  revalidatePath("/admin/performance");
  return ok("Target removed.");
}
