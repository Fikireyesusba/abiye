"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { getMfaState } from "@/lib/auth/mfa";
import { recordSecurityEvent } from "@/lib/security/events";
import { rateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "./result";

/**
 * Super Admin: remove all test orders, payments, printing jobs, wallet history, reviews and customer
 * accounts (products, settings, banks and staff are kept). Requires, in order: the exact phrase,
 * a fresh authenticator code, and (checked by the database) an "export everything" in the last 30 minutes.
 */
export async function resetTestData(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("data.manage");
  if (fd.get("understood") !== "on") return fail("Tick the box to confirm you understand this cannot be undone.");
  if (!(await rateLimit(`data-reset:${ctx.userId}`, 5, 3600))) return fail("Too many attempts. Try again later.");
  const supabase = await createSupabaseServerClient();
  const { data: phrase } = await supabase.rpc("admin_reset_phrase");
  const typed = String(fd.get("phrase") ?? "").trim();
  if (!phrase || typed !== phrase) return fail(`Type exactly: ${phrase ?? "RESET …"}`);
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return fail("Enter the 6-digit code from your authenticator app.");

  // Fresh two-step code: proves the person at the keyboard holds the Super Admin's phone.
  const mfa = await getMfaState();
  if (!mfa.factorId || mfa.userId !== ctx.userId) return fail("Two-step login is not set up for this account.");
  const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfa.factorId, code });
  if (mfaError) {
    await recordSecurityEvent("admin_mfa_failed", { userId: ctx.userId, metadata: { where: "data_reset" } });
    return fail("That authenticator code is not correct (or has expired). Try the newest code.");
  }

  const startedAt = new Date().toISOString();
  const { data: counts, error } = await supabase.rpc("admin_reset_test_data", { p_confirm: typed });
  if (error) {
    if (error.message === "invalid_request") return fail("Download “Export everything” first (within the last 30 minutes), then try again.");
    console.error("[data-reset] failed:", error.code);
    return fail("The reset failed. Nothing was deleted.");
  }

  // Remove receipts and printing documents that belonged to the deleted data.
  let files = 0;
  const admin = getSupabaseAdmin();
  for (let round = 0; round < 50; round++) {
    const { data: left } = await admin.rpc("reset_storage_leftovers", { p_before: startedAt, p_limit: 1000 });
    if (!left?.length) break;
    for (const bucket of ["payment-receipts", "printing-files"] as const) {
      const paths = left.filter((o) => o.bucket === bucket).map((o) => o.name);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmError } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (rmError) console.error(`[data-reset] file removal failed (${bucket}):`, rmError.message);
        else files += Math.min(100, paths.length - i);
      }
    }
    if (left.length < 1000) break;
  }

  revalidatePath("/", "layout");
  const c = (counts ?? {}) as Record<string, number>;
  return ok(`Reset done: ${c.orders ?? 0} orders, ${c.printing_jobs ?? 0} printing jobs, ${c.customer_accounts ?? 0} customer accounts, ${c.wallet_topups ?? 0} top-ups, ${c.reviews ?? 0} reviews and ${files} files removed. New orders start at ET-10001.`);
}
