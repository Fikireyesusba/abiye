import { NextResponse } from "next/server";
import { buildOrdersWorkbook, type ExportOrder } from "@/lib/admin/order-export";
import { ORDER_STATUSES } from "@/lib/admin/order-flow";
import { getAdminContext } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { zoneDayStartIso } from "@/lib/datetime";
import { sendExportCopy } from "@/lib/telegram/export-copy";

export const maxDuration = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 20000;
const addisStart = zoneDayStartIso; // midnight (Warsaw time) as an ISO timestamp
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Orders → Excel (.xlsx). Needs orders.view_all; reads through the admin's own session (RLS). */
export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx || ctx.role !== "super_admin" || !ctx.permissions.has("orders.view_all")) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const filter = url.searchParams.get("status") ?? "all";
  if (!DAY.test(from) || !DAY.test(to) || to < from) return new NextResponse("Choose a valid date range.", { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) return new NextResponse("Export at most one year at a time.", { status: 400 });
  const status = ORDER_STATUSES.find((s) => s === filter) ?? null;
  if (filter !== "all" && filter !== "paid" && !status) return new NextResponse("Unknown status filter.", { status: 400 });
  if (!(await rateLimit(`export:orders:${ctx.userId}`, 20, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });

  const supabase = await createSupabaseServerClient();
  const rows: ExportOrder[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    let q = supabase
      .from("orders")
      .select(`order_number, created_at, status, payment_status, customer_name, customer_phone, fulfillment_method, city, address_line,
        subtotal_etb, delivery_fee_etb, discount_etb, total_etb, payment_verified_at,
        promotion:promotions(code),
        items:order_items(item_type, name_en, sku, unit_price_etb, quantity, line_total_etb),
        payments:payment_submissions(transaction_reference, status, submitted_at)`)
      .gte("created_at", addisStart(from))
      .lt("created_at", addisStart(nextDay(to)))
      .order("created_at", { ascending: true })
      .range(offset, offset + 999);
    if (status) q = q.eq("status", status);
    if (filter === "paid") q = q.eq("payment_status", "verified");
    const { data, error } = await q;
    if (error) {
      console.error("[export] orders query failed:", error.code);
      return new NextResponse("Could not export orders.", { status: 500 });
    }
    for (const o of data ?? []) {
      const pays = [...(o.payments ?? [])].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
      const ref = (pays.find((p) => p.status === "verified") ?? pays[0])?.transaction_reference ?? null;
      const promo = o.promotion as unknown as { code: string | null } | null;
      rows.push({ ...o, promo_code: promo?.code ?? null, reference: ref, items: o.items ?? [] });
    }
    if ((data?.length ?? 0) < 1000) break;
  }

  const s = await getSiteSettings();
  const filterLabel = filter === "all" ? "All orders" : filter === "paid" ? "Paid (verified) orders" : `Status: ${filter.replaceAll("_", " ")}`;
  const file = await buildOrdersWorkbook(rows, {
    business: s.business.name.en, from, to, filter: filterLabel, generatedBy: ctx.fullName, generatedAt: new Date(),
  });
  // Exports contain customer contact details: keep a record (ignored if the database update is not applied yet).
  await supabase.rpc("admin_log_export", { p_kind: "orders", p_metadata: { from, to, filter, rows: rows.length } });

  sendExportCopy(file as ArrayBuffer | Uint8Array, `orders-${from}_to_${to}.xlsx`, "Orders", ctx.userId); // copy to the receipts Telegram group
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orders-${from}_to_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
