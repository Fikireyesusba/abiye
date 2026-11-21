import ExcelJS from "exceljs";

/** Sheet names for every exported area (Excel allows at most 31 characters). */
export const EXPORT_AREAS: { area: string; sheet: string }[] = [
  { area: "orders", sheet: "Orders" }, { area: "order_items", sheet: "Order items" }, { area: "payments", sheet: "Payments" },
  { area: "order_history", sheet: "Order status history" }, { area: "order_notes", sheet: "Order notes" },
  { area: "printing_jobs", sheet: "Printing jobs" }, { area: "printing_files", sheet: "Printing files" },
  { area: "customer_accounts", sheet: "Customer accounts" }, { area: "customers", sheet: "Customers (by phone)" },
  { area: "addresses", sheet: "Addresses" }, { area: "wallet_topups", sheet: "Wallet top-ups" }, { area: "wallet_ledger", sheet: "Wallet ledger" },
  { area: "reviews", sheet: "Reviews" }, { area: "stock_requests", sheet: "Back-in-stock requests" },
  { area: "products", sheet: "Products" }, { area: "product_images", sheet: "Product images" }, { area: "categories", sheet: "Categories" },
  { area: "inventory", sheet: "Inventory movements" }, { area: "promotions", sheet: "Promotions" },
  { area: "promotion_customers", sheet: "Personal promo codes" }, { area: "delivery_zones", sheet: "Delivery zones" },
  { area: "bank_accounts", sheet: "Bank accounts" }, { area: "printing_prices", sheet: "Printing prices" },
  { area: "banners", sheet: "Homepage banners" }, { area: "settings", sheet: "Settings" }, { area: "staff", sheet: "Staff" },
  { area: "activity_log", sheet: "Activity log" }, { area: "security_events", sheet: "Security events" },
  { area: "blocked_emails", sheet: "Blocked emails" },
];

const MAX_CELL = 32000;
function cell(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
}

/** One sheet per area: a column for every field seen, values as text/numbers (times in UTC as stored). */
export async function buildFullExport(
  data: { sheet: string; rows: Record<string, unknown>[] }[],
  meta: { business: string; generatedBy: string; generatedAt: Date },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.business;
  wb.created = meta.generatedAt;
  const about = wb.addWorksheet("About");
  about.columns = [{ width: 32 }, { width: 40 }];
  about.addRow([`${meta.business} — full data export`]).font = { bold: true, size: 14 };
  about.addRow(["Exported by", meta.generatedBy]);
  about.addRow(["Exported at (UTC)", meta.generatedAt.toISOString()]);
  about.addRow(["Note", "Times in the sheets are UTC (Ethiopia time = UTC+3). Secrets such as access codes are never exported. Receipt and document files are not included."]);
  about.addRow([]);
  about.addRow(["Sheet", "Rows"]).font = { bold: true };
  for (const d of data) about.addRow([d.sheet, d.rows.length]);

  for (const d of data) {
    const ws = wb.addWorksheet(d.sheet);
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const r of d.rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    if (!keys.length) { ws.addRow(["(no rows)"]); continue; }
    ws.columns = keys.map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(10, k.length + 2)) }));
    for (const r of d.rows) ws.addRow(keys.map((k) => cell(r[k])));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
