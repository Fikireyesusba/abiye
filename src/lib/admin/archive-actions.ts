"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { buildArchiveEmail, dispatchReceiptArchive, sendArchiveEmail } from "@/lib/email/archive";
import { emailConfigured } from "@/lib/email/dispatch";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, ok, type ActionResult } from "./result";
import { zoneDayStartIso } from "@/lib/datetime";

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addisStart = zoneDayStartIso; // midnight (Warsaw time) as an ISO timestamp
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

async function currentAddress(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_receipt_archive_status");
  return ((data ?? {}) as { email?: string | null }).email ?? null;
}

/** Super Admin: set (or clear) the archive address. The previous address is told about the change. */
export async function saveReceiptArchive(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings.manage");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (email && (email.length > 254 || !EMAIL.test(email))) return fail("Enter a valid email address.");
  if (!(await rateLimit(`archive:set:${ctx.userId}`, 10, 3600))) return fail("Too many changes. Try again later.");
  const before = await currentAddress();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_receipt_archive", { p_email: email });
  if (error) return dbError(error);
  if (before && before !== email && emailConfigured()) {
    const business = (await getSiteSettings()).business.name.en;
    const text = `The payment receipt archive address of ${business} was changed by ${ctx.fullName} to ${email || "(none — archiving turned off)"}. If you did not expect this, sign in to the admin panel and check Admin → Notifications and the Activity log.`;
    await sendArchiveEmail(before, { subject: `[Receipt archive] Archive address changed`, html: `<p>${text.replace(/[<>&]/g, "")}</p>`, text }, null, `archive-change-${Date.now()}`);
  }
  revalidatePath("/admin/notifications");
  return ok(email ? `Receipts will be archived to ${email}.` : "Receipt archiving turned off.");
}

/** Send a sample archive email (no real receipt) so the owner can check it arrives. */
export async function sendArchiveTest(): Promise<ActionResult> {
  const ctx = await requirePermission("settings.manage");
  if (!emailConfigured()) return fail("Email is not configured (RESEND_API_KEY / EMAIL_FROM in Vercel).");
  const to = await currentAddress();
  if (!to) return fail("Save an archive address first.");
  if (!(await rateLimit(`archive:test:${ctx.userId}`, 5, 3600))) return fail("Too many test emails. Try again later.");
  const business = (await getSiteSettings()).business.name.en;
  const mail = buildArchiveEmail({
    kind: "order_payment", result: "verified", number: "TEST", amount_etb: 0, reference: "TEST", customer_name: "Test only",
    decided_at: new Date().toISOString(), decided_by: ctx.fullName, receipt_name: "sample.txt", receipt_mime: "text/plain",
  }, business);
  const res = await sendArchiveEmail(to, { ...mail, subject: `[Receipt archive] Test email` },
    { filename: "sample.txt", content: Buffer.from("Sample attachment: real archive emails carry the customer's receipt here.\n") }, `archive-test-${Date.now()}`);
  return res.ok ? ok(`Test email sent to ${to}. Check the inbox (and spam folder).`) : fail(`Could not send: ${res.error}`);
}

/** Queue receipts decided in a period (e.g. before the archive was set up). Already archived ones are skipped. */
export async function archivePastReceipts(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("settings.manage");
  const from = String(fd.get("from") ?? "");
  const to = String(fd.get("to") ?? "");
  if (!DAY.test(from) || !DAY.test(to) || to < from) return fail("Choose a valid date range.");
  if (!(await rateLimit(`archive:past:${ctx.userId}`, 10, 3600))) return fail("Too many requests. Try again later.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_archive_past_receipts", { p_from: addisStart(from), p_to: addisStart(nextDay(to)) });
  if (error) {
    if (error.message === "invalid_request") return fail("Save an archive address first.");
    return dbError(error);
  }
  // Send right after the response, in batches, for up to ~50 s; the rest goes with the daily job.
  after(async () => {
    const until = Date.now() + 50_000;
    while (Date.now() < until) {
      const r = await dispatchReceiptArchive(10);
      if (!r.configured || r.sent + r.failed < 10) break;
    }
  });
  revalidatePath("/admin/notifications");
  const n = Number(data ?? 0);
  return ok(n ? `${n} receipt${n === 1 ? "" : "s"} queued — they are being emailed now (very large batches finish with the daily job).` : "Nothing new to send: those receipts are already archived.");
}
