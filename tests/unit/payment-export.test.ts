import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildPaymentsWorkbook, type ExportPayment, type ExportTopup } from "@/lib/admin/payment-export";

const pay = (n: string, status: string, amount: number, extra: Partial<ExportPayment> = {}): ExportPayment => ({
  order_number: n, order_status: status === "verified" ? "confirmed" : "payment_rejected", customer_name: "አበበ ከበደ", customer_phone: "+251911223344",
  customer_email: "abebe@example.com", amount_expected_etb: amount, order_total_etb: amount, bank_name: "CBE", account_number: "1000123",
  transaction_reference: "FT1", receipt_original_name: "r.png", submitted_at: "2026-11-19T07:00:00Z", status, reviewed_at: "2026-11-19T08:30:00Z",
  reviewed_by_name: "Owner", review_note: status === "rejected" ? "Not in bank statement" : null, reference_used_elsewhere: 0, receipt_used_elsewhere: 0, ...extra,
});
const topup: ExportTopup = {
  topup_number: "TU-1", customer_name: "Sara", customer_email: "sara@example.com", amount_etb: 500, bank_name: "CBE", account_number: "1000123",
  transaction_reference: "FT9", created_at: "2026-11-19T07:00:00Z", status: "verified", reviewed_at: "2026-11-19T08:00:00Z", reviewed_by_name: "Manager", review_note: null,
};
const meta = { business: "Abiye", from: "2026-11-01", to: "2026-11-30", filter: "Verified and rejected", generatedBy: "Owner", generatedAt: new Date("2026-11-20T08:00:00Z") };

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe("payments Excel export", () => {
  it("lists verified and rejected payments with review details, totals and warnings", async () => {
    const wb = await load(await buildPaymentsWorkbook([pay("ET-1", "verified", 1000), pay("ET-2", "rejected", 300, { reference_used_elsewhere: 1 })], [topup], meta));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Order payments", "Wallet top-ups"]);
    const ws = wb.getWorksheet("Order payments")!;
    expect(ws.rowCount).toBe(3);
    expect(ws.getCell("A3").value).toBe("Rejected");
    expect(ws.getCell("D3").value).toBe("Not in bank statement");
    expect(ws.getCell("G2").value).toBe("አበበ ከበደ");
    expect(ws.getCell("J2").value).toBe(1000);
    expect(String(ws.getCell("Q3").value)).toContain("Reference also used");
    expect((ws.getCell("B2").value as Date).toISOString()).toBe("2026-11-19T11:30:00.000Z"); // 11:30 Addis time
    const sum = wb.getWorksheet("Summary")!;
    const col = sum.getColumn(1).values;
    expect(sum.getCell(col.indexOf("Order payments verified"), 2).value).toBe(1);
    expect(sum.getCell(col.indexOf("Order payments rejected"), 2).value).toBe(1);
    expect(sum.getCell(col.indexOf("Wallet top-ups verified"), 2).value).toBe(1);
  });

  it("leaves out the top-ups sheet for staff without wallet access", async () => {
    const wb = await load(await buildPaymentsWorkbook([pay("ET-1", "verified", 1000)], null, meta));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Order payments"]);
  });
});
