import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { wallClock, zoneDayStartIso } from "@/lib/datetime";
import { rateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendExportCopy } from "@/lib/telegram/export-copy";
import { inBatches } from "@/lib/supabase/in-batches";

export const maxDuration = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const at = (iso: string | null | undefined) => (iso ? wallClock(iso)! : "");
const PLATFORM: Record<string, string> = { android: "Android", ios: "iPhone / iPad", windows: "Windows", mac: "Mac", linux: "Linux", other: "Other" };

/** Signed-in users → Excel: signed in now, last sign-in (with the page's filters) or app installs, with every detail. Super Admin. */
export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx || !ctx.permissions.has("security.manage")) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "now";
  if (!["now", "last", "installs"].includes(tab)) return new NextResponse("Invalid request.", { status: 400 });
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const day = (k: string) => { const v = url.searchParams.get(k) ?? ""; return DAY.test(v) ? v : ""; };
  const from = day("from"), to = day("to"), before = day("before");
  if (!(await rateLimit(`export:users:${ctx.userId}`, 20, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });

  const supabase = await createSupabaseServerClient();
  type Base = { user_id: string | null; member_id: string | null; full_name: string | null; email: string | null; is_staff: boolean; role_name?: string | null };
  let rows: (Base & Record<string, unknown>)[] = [];
  if (tab === "now") {
    const { data, error } = await supabase.rpc("admin_signed_in_users", { p_search: q || undefined });
    if (error) return new NextResponse("Could not export.", { status: 500 });
    rows = data ?? [];
  } else if (tab === "last") {
    const { data, error } = await supabase.rpc("admin_last_sign_ins", {
      p_from: from ? zoneDayStartIso(from) : undefined, p_to: to ? zoneDayStartIso(nextDay(to)) : undefined,
      p_before: before ? zoneDayStartIso(before) : undefined, p_search: q || undefined,
    });
    if (error) return new NextResponse("Could not export.", { status: 500 });
    rows = data ?? [];
  } else {
    const { data, error } = await supabase.rpc("admin_app_installs");
    if (error) return new NextResponse("Could not export.", { status: 500 });
    const needle = q.toLowerCase();
    rows = (data ?? []).filter((r) => !needle || r.member_id === q || (r.email ?? "").toLowerCase().includes(needle) || (r.full_name ?? "").toLowerCase().includes(needle));
  }
  // Phone, sex, date of birth (after the permission check and rate limit above).
  const ids = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const db = getSupabaseAdmin();
  const [accounts, staff] = await Promise.all([
    inBatches(ids, (b) => db.from("customer_accounts").select("id, phone, sex, date_of_birth").in("id", b)),
    inBatches(ids, (b) => db.from("profiles").select("id, phone, sex, date_of_birth").in("id", b)),
  ]);
  const person = new Map<string, { phone: string | null; sex: string | null; date_of_birth: string | null }>();
  for (const a of accounts ?? []) person.set(a.id, a);
  for (const p of staff ?? []) person.set(p.id, { phone: p.phone ?? person.get(p.id)?.phone ?? null, sex: p.sex ?? person.get(p.id)?.sex ?? null, date_of_birth: p.date_of_birth ?? person.get(p.id)?.date_of_birth ?? null });

  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.fullName;
  const title = tab === "now" ? "Signed in now" : tab === "last" ? "Last sign-in" : "App installs";
  const ws = wb.addWorksheet(title);
  const common = [
    { header: "User ID", width: 10 }, { header: "Name", width: 24 }, { header: "Email", width: 30 }, { header: "Phone", width: 16 },
    { header: "Staff / customer", width: 16 }, { header: "Role", width: 14 }, { header: "Sex", width: 8 }, { header: "Date of birth", width: 12 },
  ];
  const extra = tab === "now"
    ? [{ header: "Signed in at", width: 17 }, { header: "Last active", width: 17 }, { header: "IP address", width: 16 }, { header: "Browser / device", width: 50 }]
    : tab === "last"
      ? [{ header: "Last sign-in", width: 17 }, { header: "Account created", width: 17 }, { header: "Signed in now", width: 12 }]
      : [{ header: "Device", width: 14 }, { header: "First opened (installed)", width: 20 }, { header: "Last opened", width: 17 }, { header: "Opens", width: 8 }];
  ws.columns = [...common, ...extra];
  for (const r of rows) {
    const p = r.user_id ? person.get(r.user_id) : undefined;
    const base = [r.member_id ?? "", r.full_name ?? "", r.email ?? "", p?.phone ?? "", r.user_id ? (r.is_staff ? "Staff" : "Customer") : "Not signed in",
      r.role_name ?? "", p?.sex ?? "", p?.date_of_birth ?? ""];
    const more = tab === "now"
      ? [at(r.signed_in_at as string), at(r.last_active_at as string), (r.ip as string) ?? "", (r.user_agent as string) ?? ""]
      : tab === "last"
        ? [r.last_sign_in_at ? at(r.last_sign_in_at as string) : "never", at(r.created_at as string), r.signed_in_now ? "yes" : "no"]
        : [PLATFORM[r.platform as string] ?? String(r.platform), at(r.first_seen as string), at(r.last_seen as string), Number(r.opens)];
    ws.addRow([...base, ...more]);
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14523F" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: common.length + extra.length } };

  await supabase.rpc("admin_log_export", { p_kind: "users", p_metadata: { list: tab, q, from, to, before, rows: rows.length } });
  const file = await wb.xlsx.writeBuffer();
  const name = `users-${tab}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  sendExportCopy(file as ArrayBuffer | Uint8Array, name, `Users — ${title}`, ctx.userId, rows.length);
  return new NextResponse(new Uint8Array(file as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
