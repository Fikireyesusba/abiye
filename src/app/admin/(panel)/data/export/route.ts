import { NextResponse } from "next/server";
import { EXPORT_AREAS, buildFullExport } from "@/lib/admin/data-export";
import { getAdminContext } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;
const MAX_ROWS_PER_AREA = 100_000;

/** Everything → one Excel file (Super Admin: data.manage). Recorded; a reset requires a recent one. */
export async function GET() {
  const ctx = await getAdminContext();
  if (!ctx || !ctx.permissions.has("data.manage")) return new NextResponse("Not found", { status: 404 });
  if (!(await rateLimit(`export:all:${ctx.userId}`, 10, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });
  const supabase = await createSupabaseServerClient();
  const data: { sheet: string; rows: Record<string, unknown>[] }[] = [];
  for (const { area, sheet } of EXPORT_AREAS) {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < MAX_ROWS_PER_AREA; offset += 1000) {
      const { data: page, error } = await supabase.rpc("admin_data_export", { p_area: area, p_offset: offset, p_limit: 1000 });
      if (error) {
        console.error(`[export] ${area} failed:`, error.code);
        return new NextResponse("Could not export everything. Nothing was recorded; try again.", { status: 500 });
      }
      const list = (page ?? []) as Record<string, unknown>[];
      rows.push(...list);
      if (list.length < 1000) break;
    }
    data.push({ sheet, rows });
  }
  const file = await buildFullExport(data, { business: (await getSiteSettings()).business.name.en, generatedBy: ctx.fullName, generatedAt: new Date() });
  const { error: logError } = await supabase.rpc("admin_log_export", {
    p_kind: "all", p_metadata: { sheets: data.length, rows: data.reduce((n, d) => n + d.rows.length, 0) },
  });
  if (logError) return new NextResponse("Could not record the export. Try again.", { status: 500 });
  const day = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="full-export-${day}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
