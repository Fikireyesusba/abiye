import ExcelJS from "exceljs";
import { DATE, MONEY, addis, label, styleSheet } from "./order-export";

export interface ExportPayment {
  order_number: string;
  order_status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  amount_expected_etb: number;
  order_total_etb: number;
  bank_name: string | null;
  account_number: string | null;
  transaction_reference: string | null;
  receipt_original_name: string | null;
  submitted_at: string;
  status: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  reference_used_elsewhere: number;
  receipt_used_elsewhere: number;
}

export interface ExportTopup {
  topup_number: string;
  customer_name: string | null;
  customer_email: string | null;
  amount_etb: number;
  bank_name: string | null;
  account_number: string | null;
  transaction_reference: string | null;
  created_at: string;
  status: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
}

export interface PaymentExportMeta {
  business: string;
  from: string;
  to: string;
  filter: string;
  generatedBy: string;
  generatedAt: Date;
}

const sum = (list: { amount: number }[]) => list.reduce((s, x) => s + x.amount, 0);
const warnings = (p: ExportPayment) =>
  [
    p.reference_used_elsewhere > 0 ? `Reference also used on ${p.reference_used_elsewhere} other order(s)` : "",
    p.receipt_used_elsewhere > 0 ? `Same receipt file on ${p.receipt_used_elsewhere} other order(s)` : "",
    Number(p.amount_expected_etb) !== Number(p.order_total_etb) ? "Amount differs from order total" : "",
  ].filter(Boolean).join("; ");

/** Reviewed payments export: Summary, Order payments and (if allowed) Wallet top-ups. */
export async function buildPaymentsWorkbook(payments: ExportPayment[], topups: ExportTopup[] | null, meta: PaymentExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.business;
  wb.created = meta.generatedAt;

  const pay = payments.map((p) => ({ status: p.status, amount: Number(p.amount_expected_etb) }));
  const top = (topups ?? []).map((t) => ({ status: t.status, amount: Number(t.amount_etb) }));
  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 36 }, { width: 22 }];
  const rows: [string, string | number | Date][] = [
    [`${meta.business} — payments export`, ""],
    ["Reviewed between (Warsaw time)", `${meta.from} to ${meta.to}`],
    ["Included", meta.filter],
    ["Exported by", meta.generatedBy],
    ["Exported at", addis(meta.generatedAt.toISOString())!],
    ["", ""],
    ["Order payments verified", pay.filter((p) => p.status === "verified").length],
    ["  amount verified", sum(pay.filter((p) => p.status === "verified"))],
    ["Order payments rejected", pay.filter((p) => p.status === "rejected").length],
    ["  amount rejected", sum(pay.filter((p) => p.status === "rejected"))],
  ];
  if (topups) {
    rows.push(
      ["", ""],
      ["Wallet top-ups verified", top.filter((t) => t.status === "verified").length],
      ["  amount verified", sum(top.filter((t) => t.status === "verified"))],
      ["Wallet top-ups rejected", top.filter((t) => t.status === "rejected").length],
      ["  amount rejected", sum(top.filter((t) => t.status === "rejected"))],
    );
  }
  rows.forEach((r) => s.addRow(r));
  s.getRow(1).font = { bold: true, size: 14 };
  s.getCell(5, 2).numFmt = DATE;
  for (const r of topups ? [8, 10, 13, 15] : [8, 10]) s.getCell(r, 2).numFmt = MONEY;

  const ws = wb.addWorksheet("Order payments");
  ws.columns = [
    { header: "Result", width: 10 }, { header: "Decided", width: 17 }, { header: "Decided by", width: 20 }, { header: "Reason (if rejected)", width: 34 },
    { header: "Order", width: 12 }, { header: "Order status", width: 18 }, { header: "Customer", width: 24 }, { header: "Phone", width: 15 },
    { header: "Email", width: 26 }, { header: "Amount expected", width: 15 }, { header: "Order total", width: 14 }, { header: "Bank", width: 18 },
    { header: "Into account", width: 18 }, { header: "Bank reference", width: 18 }, { header: "Receipt file", width: 22 }, { header: "Receipt uploaded", width: 17 },
    { header: "Warnings", width: 40 },
  ];
  for (const p of payments) {
    ws.addRow([
      label(p.status), addis(p.reviewed_at), p.reviewed_by_name ?? "", p.review_note ?? "", p.order_number, label(p.order_status),
      p.customer_name, p.customer_phone, p.customer_email ?? "", Number(p.amount_expected_etb), Number(p.order_total_etb),
      p.bank_name ?? "", p.account_number ?? "", p.transaction_reference ?? "", p.receipt_original_name ?? "", addis(p.submitted_at), warnings(p),
    ]);
  }
  styleSheet(ws, [10, 11], [2, 16]);

  if (topups) {
    const tw = wb.addWorksheet("Wallet top-ups");
    tw.columns = [
      { header: "Result", width: 10 }, { header: "Decided", width: 17 }, { header: "Decided by", width: 20 }, { header: "Reason (if rejected)", width: 34 },
      { header: "Top-up", width: 10 }, { header: "Customer", width: 24 }, { header: "Email", width: 26 }, { header: "Amount", width: 14 },
      { header: "Bank", width: 18 }, { header: "Into account", width: 18 }, { header: "Bank reference", width: 18 }, { header: "Requested", width: 17 },
    ];
    for (const t of topups) {
      tw.addRow([
        label(t.status), addis(t.reviewed_at), t.reviewed_by_name ?? "", t.review_note ?? "", t.topup_number, t.customer_name ?? "",
        t.customer_email ?? "", Number(t.amount_etb), t.bank_name ?? "", t.account_number ?? "", t.transaction_reference ?? "", addis(t.created_at),
      ]);
    }
    styleSheet(tw, [8], [2, 12]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
