import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { ENTITY_LABELS, actionLabel, describeChanges, entityLabel } from "@/lib/admin/activity";
import { getAdminContext } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addisStart = (day: string) => new Date(Date.parse(`${day}T00:00:00+03:00`)).toISOString();
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const addis = (iso: string) => new Date(Date.parse(iso) + 3 * 3600 * 1000);

/** Activity log → Excel (.xlsx). Super Admin (audit.view); the export itself is recorded. */
export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx || !ctx.permissions.has("audit.view")) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const type = url.searchParams.get("type") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || to < from) return new NextResponse("Choose a valid date range.", { status: 400 });
  const entity = type in ENTITY_LABELS ? type : undefined;
  if (!(await rateLimit(`export:activity:${ctx.userId}`, 20, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });

  const supabase = await createSupabaseServerClient();
  // The API returns at most 1000 rows per request: fetch in pages (the function itself caps at 50,000).
  type Row = NonNullable<Awaited<ReturnType<typeof fetchPage>>["data"]>[number];
  const fetchPage = (offset: number) =>
    supabase.rpc("admin_activity_export", { p_from: addisStart(from), p_to: addisStart(nextDay(to)), p_entity_type: entity })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
  const rows: Row[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await fetchPage(offset);
    if (error) {
      console.error("[export] activity failed:", error.code);
      return new NextResponse("Could not export the activity log.", { status: 500 });
    }
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.fullName;
  const ws = wb.addWorksheet("Activity log");
  ws.columns = [
    { header: "When", width: 17 }, { header: "Who", width: 22 }, { header: "Role", width: 12 }, { header: "What", width: 30 },
    { header: "Area", width: 18 }, { header: "Item", width: 28 }, { header: "Changes", width: 60 }, { header: "Details", width: 40 }, { header: "Entry #", width: 9 },
  ];
  for (const r of rows) {
    const meta = Object.entries((r.metadata ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${k}: ${String(v)}`).join("\n");
    ws.addRow([
      addis(r.created_at), r.actor_name ?? "System", (r.actor_role ?? "").replaceAll("_", " "), actionLabel(r.action), entityLabel(r.entity_type),
      r.entity_label ?? r.entity_id ?? "", describeChanges(r.before_data, r.after_data, 40).join("\n"), meta, Number(r.id),
    ]);
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14523F" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
  ws.getColumn(1).numFmt = "yyyy-mm-dd hh:mm";
  for (const c of [7, 8]) ws.getColumn(c).alignment = { wrapText: true, vertical: "top" };

  await supabase.rpc("admin_log_export", { p_kind: "activity", p_metadata: { from, to, type: entity ?? "all", rows: rows.length } });
  const file = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(file as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="activity-log-${from}_to_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
