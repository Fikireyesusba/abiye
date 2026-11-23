import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { wallClock } from "@/lib/datetime";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describe } from "@/lib/telegram/format";
import { sendExportCopy } from "@/lib/telegram/export-copy";

export const maxDuration = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CHANNEL: Record<string, string> = { telegram: "Telegram", email: "Email", push: "Phone", archive: "Archive email" };

/** Notifications (sent / failed / waiting) → Excel. settings.manage; the export is recorded (needed before clearing). */
export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx || !ctx.permissions.has("settings.manage")) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || to < from) return new NextResponse("Choose a valid date range.", { status: 400 });
  if (!(await rateLimit(`export:notifications:${ctx.userId}`, 20, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });

  const supabase = await createSupabaseServerClient();
  type Row = { id: number; created_at: string; sent_at: string | null; channel: string; event_type: string; status: string; attempts: number; reference: string | null; recipient: string | null; last_error: string | null };
  const rows: Row[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await supabase.rpc("admin_notifications_export", { p_from: from, p_to: to }).range(offset, offset + 999);
    if (error) {
      console.error("[export] notifications failed:", error.code);
      return new NextResponse(error.message === "invalid_request" ? "Choose at most about one year." : "Could not export the notifications.", { status: 400 });
    }
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.fullName;
  const ws = wb.addWorksheet("Notifications");
  ws.columns = [
    { header: "Created", width: 17 }, { header: "Sent", width: 17 }, { header: "Via", width: 13 }, { header: "Service", width: 22 }, { header: "Event", width: 32 },
    { header: "About", width: 16 }, { header: "To", width: 28 }, { header: "Status", width: 10 }, { header: "Attempts", width: 9 }, { header: "Last error", width: 50 }, { header: "#", width: 9 },
  ];
  for (const r of rows) {
    const [service, event] = describe({ id: r.id, event_type: r.event_type, payload: {}, attachment_bucket: null, attachment_path: null });
    ws.addRow([wallClock(r.created_at), wallClock(r.sent_at), CHANNEL[r.channel] ?? r.channel, service, event, r.reference ?? "", r.recipient ?? "", r.status, r.attempts, r.last_error ?? "", Number(r.id)]);
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14523F" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
  for (const c of [1, 2]) ws.getColumn(c).numFmt = "yyyy-mm-dd hh:mm";
  ws.getColumn(10).alignment = { wrapText: true, vertical: "top" };

  await supabase.rpc("admin_log_export", { p_kind: "notifications", p_metadata: { from, to, type: "all", rows: rows.length } });
  const file = await wb.xlsx.writeBuffer();
  sendExportCopy(file as ArrayBuffer | Uint8Array, `notifications-${from}_to_${to}.xlsx`, "Notifications", ctx.userId, rows.length); // copy to the receipts Telegram group
  return new NextResponse(new Uint8Array(file as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="notifications-${from}_to_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
