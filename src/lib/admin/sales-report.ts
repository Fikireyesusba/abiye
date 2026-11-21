import ExcelJS from "exceljs";
import { DATE, MONEY, styleSheet } from "./order-export";
import { wallClock } from "@/lib/datetime";

export interface SalesReport {
  from: string;
  to: string;
  totals: {
    orders_placed: number; orders_paid: number; sales: number; products_sales: number; printing_sales: number; delivery_fees: number;
    discounts: number; average_order: number; paid_by_bank: number; paid_by_wallet: number;
    in_store_sales?: number; in_store_count?: number; in_store_cash?: number; in_store_mobile?: number; in_store_bank?: number; topups_count: number; topups_amount: number;
    cash_in: number; cancelled_after_payment_count: number; cancelled_after_payment_bank: number; wallet_refunds: number;
  };
  by_bank: { bank: string; account: string; orders: number; orders_amount: number; topups: number; topups_amount: number; total: number }[];
  by_day: { day: string; placed: number; paid: number; sales: number; bank: number; wallet: number; topups: number }[];
  by_staff: { name: string | null; payments: number; amount: number }[];
  top_products: { name: string; sku: string | null; quantity: number; amount: number }[];
  cancelled_after_payment: { order_number: string; total: number; method: string; cancelled_at: string; customer: string }[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** "day" + YYYY-MM-DD, or "month" + YYYY-MM → inclusive Warsaw-time date range. Falls back to today / this month. */
export function reportRange(kind: string | undefined, value: string | undefined, today: string): { kind: "day" | "month"; from: string; to: string; value: string } {
  if (kind === "month") {
    const m = value && MONTH.test(value) && value <= today.slice(0, 7) ? value : today.slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const to = `${m}-${String(last).padStart(2, "0")}`;
    return { kind: "month", from: `${m}-01`, to: to > today ? today : to, value: m };
  }
  const d = value && DAY.test(value) && value <= today && !Number.isNaN(Date.parse(value)) ? value : today;
  return { kind: "day", from: d, to: d, value: d };
}

export function reportTitle(r: { kind: "day" | "month"; value: string }): string {
  if (r.kind === "day") return `Daily closing — ${new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${r.value}T00:00:00Z`))}`;
  return `Monthly statement — ${new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.value}-01T00:00:00Z`))}`;
}

const n = (v: unknown) => Number(v ?? 0);

/** Excel: Summary, By bank account, By day, Verified by, Top products, Cancelled after payment. */
export async function buildSalesWorkbook(r: SalesReport, meta: { business: string; title: string; generatedBy: string; generatedAt: Date }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.business;
  wb.created = meta.generatedAt;
  const t = r.totals;

  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 44 }, { width: 22 }];
  const rows: [string, string | number | Date, boolean?][] = [
    [`${meta.business} — ${meta.title}`, ""],
    ["Period (Warsaw time)", `${r.from} to ${r.to}`],
    ["Exported by", meta.generatedBy],
    ["Exported at", wallClock(meta.generatedAt)!],
    ["", ""],
    ["Orders placed", n(t.orders_placed)],
    ["Orders paid (payment verified in the period)", n(t.orders_paid)],
    ["Sales (paid orders)", n(t.sales), true],
    ["  products", n(t.products_sales), true],
    ["  printing", n(t.printing_sales), true],
    ["  delivery fees", n(t.delivery_fees), true],
    ["  discounts given", -n(t.discounts), true],
    ["Average paid order", n(t.average_order), true],
    ["", ""],
    ["Paid by bank transfer (online orders)", n(t.paid_by_bank), true],
    [`In-store sales (${n(t.in_store_count ?? 0)})`, n(t.in_store_sales ?? 0), true],
    ["  cash", n(t.in_store_cash ?? 0), true],
    ["  mobile money", n(t.in_store_mobile ?? 0), true],
    ["  bank transfer", n(t.in_store_bank ?? 0), true],
    ["Paid with customer balance", n(t.paid_by_wallet), true],
    ["Wallet top-ups verified", n(t.topups_amount), true],
    ["MONEY IN (bank-paid orders + in-store sales + top-ups)", n(t.cash_in), true],
    ["", ""],
    ["Cancelled after payment (orders)", n(t.cancelled_after_payment_count)],
    ["  bank transfers to refund", n(t.cancelled_after_payment_bank), true],
    ["Refunded to customer balances", n(t.wallet_refunds), true],
  ];
  rows.forEach(([a, b, money]) => {
    const row = s.addRow([a, b]);
    if (money) row.getCell(2).numFmt = MONEY;
  });
  s.getRow(1).font = { bold: true, size: 14 };
  s.getCell(4, 2).numFmt = DATE;
  s.getRow(18).font = { bold: true };

  const bk = wb.addWorksheet("By bank account");
  bk.columns = [
    { header: "Bank", width: 22 }, { header: "Account", width: 20 }, { header: "Orders", width: 9 }, { header: "Order payments", width: 16 },
    { header: "Top-ups", width: 9 }, { header: "Top-up amount", width: 16 }, { header: "Total in", width: 16 },
  ];
  for (const b of r.by_bank) bk.addRow([b.bank, b.account, n(b.orders), n(b.orders_amount), n(b.topups), n(b.topups_amount), n(b.total)]);
  styleSheet(bk, [4, 6, 7], []);

  const dy = wb.addWorksheet("By day");
  dy.columns = [
    { header: "Day", width: 12 }, { header: "Orders placed", width: 14 }, { header: "Orders paid", width: 12 }, { header: "Sales", width: 16 },
    { header: "Paid by bank", width: 16 }, { header: "Paid with balance", width: 18 }, { header: "Top-ups", width: 16 },
  ];
  for (const d of r.by_day) dy.addRow([d.day, n(d.placed), n(d.paid), n(d.sales), n(d.bank), n(d.wallet), n(d.topups)]);
  styleSheet(dy, [4, 5, 6, 7], []);

  const st = wb.addWorksheet("Verified by");
  st.columns = [{ header: "Staff member", width: 26 }, { header: "Payments verified", width: 18 }, { header: "Amount", width: 16 }];
  for (const x of r.by_staff) st.addRow([x.name ?? "Unknown", n(x.payments), n(x.amount)]);
  styleSheet(st, [3], []);

  const tp = wb.addWorksheet("Top products");
  tp.columns = [{ header: "Product", width: 40 }, { header: "SKU", width: 16 }, { header: "Quantity", width: 10 }, { header: "Amount", width: 16 }];
  for (const p of r.top_products) tp.addRow([p.name, p.sku ?? "", n(p.quantity), n(p.amount)]);
  styleSheet(tp, [4], []);

  const cx = wb.addWorksheet("Cancelled after payment");
  cx.columns = [{ header: "Order", width: 12 }, { header: "Customer", width: 24 }, { header: "Paid by", width: 16 }, { header: "Total", width: 14 }, { header: "Cancelled", width: 18 }];
  for (const c of r.cancelled_after_payment) {
    cx.addRow([c.order_number, c.customer, c.method === "wallet" ? "Balance (refunded)" : "Bank — refund due", n(c.total), wallClock(c.cancelled_at)!]);
  }
  styleSheet(cx, [4], [5]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
