"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchSoon } from "@/lib/telegram/dispatch";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

/** Manager / Super Admin: verify or reject a top-up (after checking the bank account). */
export async function reviewTopup(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("wallet.manage");
  const parsed = z.object({ topupId: z.guid(), decision: z.enum(["verified", "rejected"]), note: z.string().trim().max(1000).optional() }).safeParse(formObject(fd));
  if (!parsed.success) return fail("Invalid request.");
  if (parsed.data.decision === "rejected" && !parsed.data.note) return fail("Please enter the reason (the customer will see it).");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_review_topup", { p_topup_id: parsed.data.topupId, p_decision: parsed.data.decision, p_note: parsed.data.note || undefined });
  if (error) return error.message === "wallet_limit" ? fail("Verifying this would take the balance above 10,000 ETB. Reject it with a reason instead.") : dbError(error);
  dispatchSoon(); // customer email / phone notification
  revalidatePath("/admin", "layout");
  return ok(parsed.data.decision === "verified" ? "Top-up verified — balance updated." : "Top-up rejected — customer informed.");
}

/** Super Admin: manual correction with a reason (positive = credit, negative = debit). */
export async function adjustWallet(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("wallet.adjust");
  const parsed = z.object({ userId: z.guid(), amount: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 10000 && Math.round(n * 100) === n * 100), reason: z.string().trim().min(3).max(500) })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail("Enter an amount (e.g. 200 or -200) and a reason.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_adjust_wallet", { p_user_id: parsed.data.userId, p_amount: parsed.data.amount, p_reason: parsed.data.reason });
  if (error) {
    if (error.message === "wallet_limit") return fail("That would take the balance above 10,000 ETB.");
    if (error.message === "wallet_insufficient") return fail("The balance cannot go below 0.");
    return dbError(error);
  }
  revalidatePath(`/admin/customers/${parsed.data.userId}`);
  revalidatePath("/admin/wallet");
  return ok(`Balance corrected. New balance: ${Number((data as { balance_etb: number }).balance_etb).toFixed(2)} ETB.`);
}
