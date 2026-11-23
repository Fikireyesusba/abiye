import { NextResponse } from "next/server";
import { buildPaymentsWorkbook, type ExportPayment, type ExportTopup } from "@/lib/admin/payment-export";
import { getAdminContext } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { zoneDayStartIso } from "@/lib/datetime";
import { sendExportCopy } from "@/lib/telegram/export-copy";

export const maxDuration = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 50000;
const addisStart = zoneDayStartIso; // midnight (Warsaw time) as an ISO timestamp
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const FILTERS = { all: "Verified and rejected", verified: "Verified only", rejected: "Rejected only" } as const;

/** Reviewed (verified / rejected) payments → Excel. Needs payments.view; top-ups sheet only with wallet.manage. */
export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx || ctx.role !== "super_admin" || !ctx.permissions.has("payments.view")) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const filter = url.searchParams.get("status") ?? "all";
  if (!DAY.test(from) || !DAY.test(to) || to < from) return new NextResponse("Choose a valid date range.", { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) return new NextResponse("Export at most one year at a time.", { status: 400 });
  if (!(filter in FILTERS)) return new NextResponse("Unknown filter.", { status: 400 });
  const status = filter === "all" ? undefined : filter;
  const withTopups = ctx.permissions.has("wallet.manage") && url.searchParams.get("topups") === "1";
  if (!(await rateLimit(`export:payments:${ctx.userId}`, 20, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });

  const supabase = await createSupabaseServerClient();
  const range = { p_from: addisStart(from), p_to: addisStart(nextDay(to)), p_status: status };
  // The API returns at most 1000 rows per request: fetch in pages.
  const payments: ExportPayment[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    const { data, error } = await supabase.rpc("admin_payments_export", range).order("reviewed_at").order("id").range(offset, offset + 999);
    if (error) {
      console.error("[export] payments failed:", error.code);
      return new NextResponse("Could not export payments.", { status: 500 });
    }
    payments.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  let topups: ExportTopup[] | null = null;
  if (withTopups) {
    topups = [];
    for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
      const { data, error } = await supabase.rpc("admin_topups_export", range).order("reviewed_at").order("id").range(offset, offset + 999);
      if (error) {
        console.error("[export] top-ups failed:", error.code);
        return new NextResponse("Could not export payments.", { status: 500 });
      }
      topups.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const s = await getSiteSettings();
  const file = await buildPaymentsWorkbook(payments, topups, {
    business: s.business.name.en, from, to, filter: FILTERS[filter as keyof typeof FILTERS], generatedBy: ctx.fullName, generatedAt: new Date(),
  });
  // Exports contain customer contact and bank details: keep a record.
  await supabase.rpc("admin_log_export", { p_kind: "payments", p_metadata: { from, to, filter, rows: payments.length, topups: topups?.length ?? 0 } });

  sendExportCopy(file as ArrayBuffer | Uint8Array, `payments-${from}_to_${to}.xlsx`, "Payments", ctx.userId); // copy to the receipts Telegram group
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="payments-${from}_to_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
