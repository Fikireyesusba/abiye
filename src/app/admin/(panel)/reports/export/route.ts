import { NextResponse } from "next/server";
import { buildSalesWorkbook, reportRange, reportTitle, type SalesReport } from "@/lib/admin/sales-report";
import { getAdminContext } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Sales report → Excel (Super Admin: analytics.view). */
export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx || !ctx.permissions.has("analytics.view")) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const today = new Date(new Date().getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const range = reportRange(url.searchParams.get("kind") ?? undefined, url.searchParams.get("value") ?? undefined, today);
  if (!(await rateLimit(`export:sales:${ctx.userId}`, 30, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_sales_report", { p_from: range.from, p_to: range.to });
  if (error || !data) {
    console.error("[export] sales report failed:", error?.code);
    return new NextResponse("Could not build the report.", { status: 500 });
  }
  const title = reportTitle(range);
  const file = await buildSalesWorkbook(data as unknown as SalesReport, {
    business: (await getSiteSettings()).business.name.en, title, generatedBy: ctx.fullName, generatedAt: new Date(),
  });
  await supabase.rpc("admin_log_export", { p_kind: "sales", p_metadata: { kind: range.kind, from: range.from, to: range.to } });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sales-${range.kind}-${range.value}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
