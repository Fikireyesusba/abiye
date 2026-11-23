import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import type { Permission } from "@/lib/auth/permissions";
import { getAdminContext } from "@/lib/auth/guards";
import { memberIds } from "@/lib/admin/member-ids";
import { TICKET_LABEL, TICKET_TOPIC } from "@/lib/admin/support";
import { KPI_METRICS, achievement, scaledTarget, type KpiMetric } from "@/lib/admin/kpi";
import { wallClock, zoneDayStartIso } from "@/lib/datetime";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendExportCopy } from "@/lib/telegram/export-copy";
import { inBatches } from "@/lib/supabase/in-batches";

export const maxDuration = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const at = (iso: string | null | undefined) => (iso ? wallClock(iso)! : "");
const KINDS: Record<string, { perm: Permission; title: string; dated: boolean }> = {
  support: { perm: "support.view", title: "Support tickets", dated: true },
  customers: { perm: "customers.view", title: "Customers", dated: false },
  products: { perm: "products.view", title: "Products & stock", dated: false },
  wallet: { perm: "wallet.manage", title: "Wallet", dated: true },
  printing: { perm: "printing.view", title: "Printing jobs", dated: true },
  kpi: { perm: "kpi.view", title: "Staff performance (KPIs)", dated: true },
  promotions: { perm: "promotions.manage", title: "Promotion uses", dated: true },
};
type Sheet = { name: string; columns: { header: string; width: number }[]; rows: unknown[][] };

/** Excel exports of important data (one per area). Each is recorded and copied to the receipts Telegram group. */
export async function GET(request: Request) {
  const ctx = await getAdminContext();
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const def = KINDS[kind];
  if (!ctx || ctx.role !== "super_admin" || !def || !ctx.permissions.has(def.perm)) return new NextResponse("Not found", { status: 404 });
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (def.dated && (!DAY.test(from) || !DAY.test(to) || to < from)) return new NextResponse("Choose a valid date range.", { status: 400 });
  if (!(await rateLimit(`export:${kind}:${ctx.userId}`, 20, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });
  const pFrom = def.dated ? zoneDayStartIso(from) : undefined;
  const pTo = def.dated ? zoneDayStartIso(nextDay(to)) : undefined;
  const supabase = await createSupabaseServerClient();
  const sheets: Sheet[] = [];
  const fail = (what: string) => new NextResponse(`Could not export ${what}.`, { status: 500 });

  if (kind === "support") {
    const { data, error } = await supabase.rpc("admin_support_tickets", { p_from: pFrom, p_to: pTo, p_limit: 5000 });
    if (error) return fail("support tickets");
    sheets.push({
      name: "Support tickets",
      columns: [
        { header: "Ticket", width: 9 }, { header: "User ID", width: 9 }, { header: "Topic", width: 16 }, { header: "Subject", width: 28 }, { header: "Details", width: 60 },
        { header: "Order", width: 12 }, { header: "Status", width: 18 }, { header: "Assigned to", width: 18 }, { header: "Opened", width: 17 }, { header: "Last message", width: 17 },
        { header: "Messages", width: 9 }, { header: "Resolved", width: 17 }, { header: "Closed", width: 17 }, { header: "Rating (1-5)", width: 11 }, { header: "Rating feedback", width: 40 },
      ],
      rows: (data ?? []).map((r) => [r.ticket_number, r.member_id ?? "", TICKET_TOPIC[r.category] ?? r.category, r.subject, r.details, r.order_number ?? "",
        TICKET_LABEL[r.status] ?? r.status, r.assigned_name ?? "", at(r.created_at), at(r.last_message_at), Number(r.messages), at(r.resolved_at), at(r.closed_at),
        r.rating ?? "", r.rating_comment ?? ""]),
    });
  } else if (kind === "customers") {
    const { data, error } = await supabase.rpc("admin_customer_accounts", { p_limit: 500 });
    if (error) return fail("customers");
    const ids = (data ?? []).map((r) => r.id);
    const extra = await inBatches(ids, (b) => supabase.from("customer_accounts").select("id, sex, date_of_birth, wallet_balance_etb, default_address").in("id", b));
    const more = new Map(extra.map((e) => [e.id, e]));
    sheets.push({
      name: "Customers",
      columns: [
        { header: "User ID", width: 9 }, { header: "Name", width: 24 }, { header: "Email", width: 30 }, { header: "Phone", width: 15 }, { header: "Sex", width: 8 },
        { header: "Date of birth", width: 12 }, { header: "Status", width: 14 }, { header: "Orders", width: 8 }, { header: "Last order", width: 17 },
        { header: "Balance (ETB)", width: 12 }, { header: "Address", width: 30 }, { header: "Joined", width: 17 }, { header: "Last sign-in", width: 17 },
      ],
      rows: (data ?? []).map((r) => {
        const e = more.get(r.id);
        return [r.member_id ?? "", r.full_name ?? "", r.email, r.phone ?? "", e?.sex ?? "", e?.date_of_birth ?? "",
          r.deactivated_at ? "Deactivated" : r.email_confirmed_at ? "Confirmed" : "Not confirmed", Number(r.order_count), at(r.last_order_at),
          Number(e?.wallet_balance_etb ?? 0), e?.default_address ?? "", at(r.created_at), at(r.last_sign_in_at)];
      }),
    });
  } else if (kind === "products") {
    const { data, error } = await supabase.from("products")
      .select("sku, name_en, name_am, brand, audience, price_etb, sale_price_etb, effective_price_etb, stock_quantity, low_stock_threshold, track_inventory, status, rating_avg, rating_count, created_at, category:categories(name_en)")
      .order("name_en").limit(5000);
    if (error) return fail("products");
    sheets.push({
      name: "Products & stock",
      columns: [
        { header: "SKU", width: 14 }, { header: "Name (English)", width: 32 }, { header: "Name (Amharic)", width: 28 }, { header: "Category", width: 18 }, { header: "Brand", width: 14 },
        { header: "For", width: 9 }, { header: "Price (ETB)", width: 11 }, { header: "Sale price", width: 10 }, { header: "Price now", width: 10 }, { header: "In stock", width: 9 },
        { header: "Low-stock level", width: 12 }, { header: "Stock tracked", width: 11 }, { header: "Status", width: 10 }, { header: "Rating", width: 8 }, { header: "Reviews", width: 8 }, { header: "Added", width: 17 },
      ],
      rows: (data ?? []).map((p) => [p.sku, p.name_en, p.name_am, (p.category as { name_en?: string } | null)?.name_en ?? "", p.brand ?? "", p.audience ?? "",
        Number(p.price_etb), p.sale_price_etb === null ? "" : Number(p.sale_price_etb), Number(p.effective_price_etb), p.stock_quantity, p.low_stock_threshold,
        p.track_inventory ? "yes" : "no", p.status, p.rating_avg === null ? "" : Number(p.rating_avg), p.rating_count, at(p.created_at)]),
    });
  } else if (kind === "wallet") {
    const [{ data: balances, error: e1 }, { data: topups, error: e2 }] = await Promise.all([
      supabase.rpc("admin_wallet_balances", { p_limit: 1000 }),
      supabase.from("wallet_topups").select("topup_number, user_id, amount_etb, transaction_reference, status, review_note, created_at, reviewed_at")
        .gte("created_at", pFrom!).lt("created_at", pTo!).order("created_at").limit(5000),
    ]);
    if (e1 || e2) return fail("the wallet");
    const ids = await memberIds([...(balances ?? []).map((b) => b.user_id), ...(topups ?? []).map((t) => t.user_id)]);
    sheets.push({
      name: "Balances (now)",
      columns: [{ header: "User ID", width: 9 }, { header: "Balance (ETB)", width: 13 }, { header: "Last activity", width: 17 }],
      rows: (balances ?? []).map((b) => [ids.get(b.user_id) ?? "", Number(b.balance_etb), at(b.last_activity)]),
    });
    sheets.push({
      name: "Top-ups",
      columns: [{ header: "Top-up", width: 11 }, { header: "User ID", width: 9 }, { header: "Amount (ETB)", width: 12 }, { header: "Reference", width: 18 },
        { header: "Status", width: 10 }, { header: "Note", width: 30 }, { header: "Requested", width: 17 }, { header: "Decided", width: 17 }],
      rows: (topups ?? []).map((t) => [t.topup_number, ids.get(t.user_id) ?? "", Number(t.amount_etb), t.transaction_reference ?? "", t.status, t.review_note ?? "", at(t.created_at), at(t.reviewed_at)]),
    });
  } else if (kind === "kpi") {
    const [{ data, error }, { data: targets }] = await Promise.all([
      supabase.rpc("admin_staff_kpis", { p_from: pFrom!, p_to: pTo! }),
      supabase.from("kpi_targets").select("metric, period, profile_id, target"),
    ]);
    if (error) return fail("staff performance");
    const days = Math.round((Date.parse(pTo!) - Date.parse(pFrom!)) / 86400000);
    const targetFor = (metric: KpiMetric, userId: string) => {
      const t = (targets ?? []).find((x) => x.metric === metric && x.profile_id === userId) ?? (targets ?? []).find((x) => x.metric === metric && !x.profile_id);
      return t ? scaledTarget(metric, Number(t.target), t.period, days) : null;
    };
    sheets.push({
      name: "Staff KPIs",
      columns: [
        { header: "User ID", width: 9 }, { header: "Name", width: 22 }, { header: "Role", width: 12 },
        ...KPI_METRICS.flatMap((m) => [{ header: `${m.label}${m.unit ? ` (${m.unit})` : ""}`, width: 14 }, { header: "Target", width: 9 }, { header: "% of target", width: 10 }]),
        { header: "Ticket replies", width: 10 }, { header: "Avg rating", width: 9 }, { header: "Order steps", width: 10 }, { header: "Payments rejected", width: 11 },
        { header: "Top-ups rejected", width: 11 }, { header: "In-store sales (ETB)", width: 14 },
      ],
      rows: (data ?? []).map((r) => [r.member_id ?? "", r.full_name, r.role_name ?? "",
        ...KPI_METRICS.flatMap((m) => {
          const raw = r[m.key as keyof typeof r];
          const v = raw === null || raw === undefined ? null : Number(raw);
          const target = targetFor(m.key, r.user_id);
          const pct = achievement(m.key, v, target);
          return [v ?? "", target ?? "", pct === null ? "" : pct / 100];
        }),
        Number(r.ticket_replies), r.ticket_rating === null ? "" : Number(r.ticket_rating), Number(r.order_steps), Number(r.payments_rejected),
        Number(r.topups_rejected), Number(r.instore_sales_etb)]),
    });
  } else if (kind === "promotions") {
    // Orders paid with a promo code (payment approved in the chosen dates): before / after the discount.
    const { data, error } = await supabase.rpc("admin_promotion_uses", { p_from: pFrom!, p_to: pTo!, p_limit: 20000 });
    if (error) return fail("promotion uses");
    sheets.push({
      name: "Promotion uses",
      columns: [
        { header: "User ID", width: 9 }, { header: "Order", width: 12 }, { header: "Promo code", width: 18 }, { header: "Promotion", width: 24 },
        { header: "For", width: 18 }, { header: "Discount rule", width: 13 }, { header: "Items", width: 50 },
        { header: "Products (ETB)", width: 13 }, { header: "Delivery (ETB)", width: 12 }, { header: "Original price (ETB)", width: 16 },
        { header: "Discount (ETB)", width: 13 }, { header: "Price after discount (ETB)", width: 20 }, { header: "Paid with", width: 12 },
        { header: "Order status", width: 14 }, { header: "Ordered", width: 17 }, { header: "Payment approved", width: 17 }, { header: "Promotion now", width: 13 },
      ],
      rows: (data ?? []).map((r) => [r.member_id ?? "", r.order_number, r.code ?? "", r.promotion, r.audience, r.discount_rule, r.items ?? "",
        Number(r.subtotal_etb), Number(r.delivery_fee_etb), Number(r.original_total_etb), Number(r.discount_etb), Number(r.total_etb),
        r.payment_method === "wallet" ? "Balance" : r.payment_method === "bank_transfer" ? "Bank transfer" : r.payment_method, r.order_status,
        at(r.ordered_at), at(r.paid_at), r.promotion_status]),
    });
  } else if (kind === "printing") {
    const { data, error } = await supabase.from("printing_jobs")
      .select("job_number, user_id, color_mode, paper_size, sides, copies, page_count, total_etb, fulfillment_method, status, created_at, order:orders(order_number)")
      .gte("created_at", pFrom!).lt("created_at", pTo!).order("created_at").limit(5000);
    if (error) return fail("printing jobs");
    const ids = await memberIds((data ?? []).map((j) => j.user_id));
    sheets.push({
      name: "Printing jobs",
      columns: [
        { header: "Job", width: 10 }, { header: "User ID", width: 9 }, { header: "Order", width: 12 }, { header: "Colour", width: 8 }, { header: "Paper", width: 7 }, { header: "Sides", width: 8 },
        { header: "Copies", width: 7 }, { header: "Pages", width: 7 }, { header: "Total (ETB)", width: 11 }, { header: "Hand-over", width: 10 }, { header: "Status", width: 18 }, { header: "Created", width: 17 },
      ],
      rows: (data ?? []).map((j) => [j.job_number, j.user_id ? ids.get(j.user_id) ?? "" : "", (j.order as { order_number?: string } | null)?.order_number ?? "",
        j.color_mode === "color" ? "Colour" : "B/W", j.paper_size, j.sides, j.copies, j.page_count ?? "", j.total_etb === null ? "" : Number(j.total_etb), j.fulfillment_method, j.status, at(j.created_at)]),
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.fullName;
  let total = 0;
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name);
    ws.columns = sh.columns;
    for (const r of sh.rows) ws.addRow(r);
    total += sh.rows.length;
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14523F" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sh.columns.length } };
  }
  await supabase.rpc("admin_log_export", { p_kind: kind, p_metadata: def.dated ? { from, to, rows: total } : { rows: total } });
  const file = await wb.xlsx.writeBuffer();
  const name = `${kind}-${def.dated ? `${from}_to_${to}` : new Date().toISOString().slice(0, 10)}.xlsx`;
  sendExportCopy(file as ArrayBuffer | Uint8Array, name, def.title, ctx.userId, total);
  return new NextResponse(new Uint8Array(file as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
