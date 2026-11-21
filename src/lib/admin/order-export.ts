import ExcelJS from "exceljs";
import { wallClock } from "@/lib/datetime";

export interface ExportOrder {
  order_number: string;
  created_at: string;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_phone: string;
  fulfillment_method: string;
  city: string | null;
  address_line: string | null;
  subtotal_etb: number;
  delivery_fee_etb: number;
  discount_etb: number;
  total_etb: number;
  payment_verified_at: string | null;
  promo_code: string | null;
  reference: string | null;
  items: { item_type: string; name_en: string; sku: string | null; unit_price_etb: number; quantity: number; line_total_etb: number }[];
}

export interface ExportMeta {
  business: string;
  from: string; // YYYY-MM-DD (Warsaw time)
  to: string;
  filter: string;
  generatedBy: string;
  generatedAt: Date;
}

export const MONEY = '#,##0.00 "ETB"';
export const DATE = "yyyy-mm-dd hh:mm";
export const label = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

/** Excel shows the stored clock time: store the Warsaw wall-clock time. */
export const addis = (iso: string | null) => wallClock(iso);

export function styleSheet(ws: ExcelJS.Worksheet, moneyCols: number[], dateCols: number[]) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14523F" } };
  header.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  for (const c of moneyCols) ws.getColumn(c).numFmt = MONEY;
  for (const c of dateCols) ws.getColumn(c).numFmt = DATE;
}

/** Orders export: Summary, Orders (one row per order) and Items (one row per line). */
export async function buildOrdersWorkbook(orders: ExportOrder[], meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.business;
  wb.created = meta.generatedAt;

  // ---- Summary
  const sum = wb.addWorksheet("Summary");
  const paid = orders.filter((o) => o.payment_status === "verified");
  const total = (list: ExportOrder[], k: "total_etb" | "delivery_fee_etb" | "discount_etb") => list.reduce((s, o) => s + Number(o[k]), 0);
  sum.columns = [{ width: 34 }, { width: 22 }];
  const rows: [string, string | number | Date][] = [
    [`${meta.business} — orders export`, ""],
    ["Period (Warsaw time)", `${meta.from} to ${meta.to}`],
    ["Filter", meta.filter],
    ["Exported by", meta.generatedBy],
    ["Exported at", addis(meta.generatedAt.toISOString())!],
    ["", ""],
    ["Orders", orders.length],
    ["Items sold (all orders)", orders.reduce((s, o) => s + o.items.reduce((n, i) => n + i.quantity, 0), 0)],
    ["Order value (all orders)", total(orders, "total_etb")],
    ["Paid (verified) orders", paid.length],
    ["Verified revenue", total(paid, "total_etb")],
    ["  of which delivery fees", total(paid, "delivery_fee_etb")],
    ["  discounts given (verified)", total(paid, "discount_etb")],
    ["", ""],
    ["Orders by status", ""],
  ];
  const byStatus = new Map<string, number>();
  for (const o of orders) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  for (const [s, n] of [...byStatus].sort((a, b) => b[1] - a[1])) rows.push([`  ${label(s)}`, n]);
  rows.forEach((r) => sum.addRow(r));
  sum.getRow(1).font = { bold: true, size: 14 };
  for (const r of [9, 11, 12, 13]) sum.getCell(r, 2).numFmt = MONEY;
  sum.getCell(5, 2).numFmt = DATE;
  sum.getCell(15, 1).font = { bold: true };

  // ---- Orders
  const ws = wb.addWorksheet("Orders");
  ws.columns = [
    { header: "Order", width: 12 }, { header: "Placed", width: 17 }, { header: "Status", width: 18 }, { header: "Payment", width: 20 },
    { header: "Customer", width: 24 }, { header: "Phone", width: 15 }, { header: "Delivery / pickup", width: 14 }, { header: "City", width: 14 },
    { header: "Address", width: 30 }, { header: "Items", width: 7 }, { header: "Subtotal", width: 14 }, { header: "Delivery fee", width: 13 },
    { header: "Discount", width: 12 }, { header: "Promo code", width: 12 }, { header: "Total", width: 14 }, { header: "Payment verified", width: 17 },
    { header: "Bank reference", width: 18 },
  ];
  for (const o of orders) {
    ws.addRow([
      o.order_number, addis(o.created_at), label(o.status), label(o.payment_status), o.customer_name, o.customer_phone,
      label(o.fulfillment_method), o.city ?? "", o.address_line ?? "", o.items.reduce((n, i) => n + i.quantity, 0),
      Number(o.subtotal_etb), Number(o.delivery_fee_etb), Number(o.discount_etb), o.promo_code ?? "", Number(o.total_etb),
      addis(o.payment_verified_at), o.reference ?? "",
    ]);
  }
  styleSheet(ws, [11, 12, 13, 15], [2, 16]);

  // ---- Items
  const it = wb.addWorksheet("Items");
  it.columns = [
    { header: "Order", width: 12 }, { header: "Placed", width: 17 }, { header: "Order status", width: 18 }, { header: "Type", width: 10 },
    { header: "Product / job", width: 36 }, { header: "SKU", width: 14 }, { header: "Unit price", width: 13 }, { header: "Qty", width: 6 },
    { header: "Line total", width: 14 },
  ];
  for (const o of orders) {
    for (const i of o.items) {
      it.addRow([o.order_number, addis(o.created_at), label(o.status), label(i.item_type), i.name_en, i.sku ?? "",
        Number(i.unit_price_etb), i.quantity, Number(i.line_total_etb)]);
    }
  }
  styleSheet(it, [7, 9], [2]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
