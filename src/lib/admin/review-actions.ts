"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

/** Approve or reject a product review (reviews.manage). Approved reviews appear on the product page. */
export async function moderateReview(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("reviews.manage");
  const parsed = z
    .object({ reviewId: z.guid(), decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_moderate_review", {
    p_review_id: parsed.data.reviewId, p_decision: parsed.data.decision, p_note: parsed.data.note || undefined,
  });
  if (error) return dbError(error);
  revalidatePath("/admin/reviews");
  revalidatePath("/products/[slug]", "page");
  return ok(parsed.data.decision === "approved" ? "Review published." : "Review rejected.");
}
