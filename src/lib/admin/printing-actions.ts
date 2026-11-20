"use server";
import { revalidatePath } from "next/cache";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const guid = z.guid();

export async function quotePrintingJob(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("printing.manage");
  const parsed = z
    .object({
      jobId: guid,
      pageCount: z.coerce.number().int().min(1, "Enter the total number of pages").max(5000),
      total: z.union([z.literal(""), z.coerce.number().positive().max(1_000_000)]).optional(),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the quote.");
  const { jobId, pageCount, total, note } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_quote_printing_job", {
    p_job_id: jobId,
    p_page_count: pageCount,
    p_total_etb: typeof total === "number" ? total : undefined,
    p_note: note || undefined,
  });
  if (error) {
    if (error.message === "no_price_rule") return fail("No active price for these options — enter a total price manually.");
    return dbError(error);
  }
  dispatchSoon(); // customer email: price ready
  revalidatePath(`/admin/printing/${jobId}`);
  revalidatePath("/admin/printing");
  return ok(`Quote saved: ${(data as { total_etb: number }).total_etb} ETB. The customer can now pay from their job page.`);
}

export async function updatePrintingStatus(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("printing.manage");
  const parsed = z
    .object({ jobId: guid, status: z.enum(["printing", "ready", "completed", "cancelled"]), note: z.string().trim().max(500).optional() })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_printing_status", {
    p_job_id: parsed.data.jobId, p_status: parsed.data.status, p_note: parsed.data.note || undefined,
  });
  if (error) {
    if (error.message === "cancel_order_instead") return fail("This job belongs to an active order — cancel the order instead.");
    return dbError(error);
  }
  dispatchSoon(); // customer email: ready
  // Picked up → the customer's documents are deleted now (the job record is kept).
  // If this fails, the daily storage maintenance job removes them (the database marked them due).
  let cleaned = "";
  if (parsed.data.status === "completed") {
    const removed = await removeJobFiles(supabase, parsed.data.jobId);
    cleaned = removed === null ? " The documents will be deleted by the daily clean-up." : removed > 0 ? ` ${removed} document${removed === 1 ? "" : "s"} deleted.` : "";
  }
  revalidatePath(`/admin/printing/${parsed.data.jobId}`);
  revalidatePath("/admin/printing");
  return ok(`Job status updated.${cleaned}`);
}

/** Remove a finished job's documents from storage and record it. Returns the number deleted, or null on failure. */
async function removeJobFiles(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, jobId: string): Promise<number | null> {
  const { data: job } = await supabase.from("printing_jobs").select("status, files:printing_files(storage_path, deleted_at)").eq("id", jobId).maybeSingle();
  if (!job || ["payment_verification", "printing", "ready"].includes(job.status)) return null;
  const paths = job.files.filter((f) => !f.deleted_at).map((f) => f.storage_path);
  if (!paths.length) return 0;
  const { error: rmError } = await supabase.storage.from("printing-files").remove(paths);
  if (rmError) {
    console.error("[printing] could not delete documents after pickup:", rmError.message);
    return null;
  }
  const { data, error } = await supabase.rpc("admin_mark_printing_files_deleted", { p_job_id: jobId });
  if (error) {
    console.error("[printing] could not record deleted documents:", error.code);
    return null;
  }
  return Number(data ?? paths.length);
}

export async function deletePrintingFiles(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("printing.manage");
  const jobId = guid.safeParse(fd.get("jobId"));
  if (!jobId.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase.from("printing_jobs").select("status").eq("id", jobId.data).maybeSingle();
  if (!job) return fail("Job not found.");
  if (["payment_verification", "printing", "ready"].includes(job.status)) return fail("Files are still needed for this job.");
  if ((await removeJobFiles(supabase, jobId.data)) === null) return fail("Could not delete the files from storage.");
  revalidatePath(`/admin/printing/${jobId.data}`);
  return ok("Customer files deleted.");
}

const ruleSchema = z.object({
  id: z.union([z.literal(""), guid]),
  color_mode: z.enum(["bw", "color"]),
  paper_size: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/, "Paper size: letters/digits, e.g. A4"),
  sides: z.enum(["single", "double"]),
  price_per_page_etb: z.coerce.number().positive("Price must be above 0").max(10000),
  sort_order: z.coerce.number().int().min(0).max(1000),
  is_active: z.literal("on").optional(),
});

export async function savePriceRule(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("printing.pricing");
  const parsed = ruleSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the price.");
  const { id, is_active, ...rest } = parsed.data;
  const row = { ...rest, is_active: is_active === "on" };
  const supabase = await createSupabaseServerClient();
  const { error } = id ? await supabase.from("printing_price_rules").update(row).eq("id", id) : await supabase.from("printing_price_rules").insert(row);
  if (error) {
    if (error.code === "23505") return fail("A price for this colour / size / sides combination already exists — edit it instead.");
    return dbError(error);
  }
  revalidatePath("/admin/printing/prices");
  revalidatePath("/printing");
  return ok("Price saved. New requests use it; existing quotes keep their price.");
}
