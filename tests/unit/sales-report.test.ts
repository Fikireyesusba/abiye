import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildSalesWorkbook, reportRange, reportTitle, type SalesReport } from "@/lib/admin/sales-report";

describe("sales report ranges", () => {
  it("day and month ranges, never in the future, with safe fallbacks", () => {
    expect(reportRange("day", "2026-11-05", "2026-11-20")).toEqual({ kind: "day", from: "2026-11-05", to: "2026-11-05", value: "2026-11-05" });
    expect(reportRange("day", "2026-12-01", "2026-11-20").value).toBe("2026-11-20");
    expect(reportRange("day", "garbage", "2026-11-20").value).toBe("2026-11-20");
    expect(reportRange("month", "2026-02", "2026-11-20")).toEqual({ kind: "month", from: "2026-02-01", to: "2026-02-28", value: "2026-02" });
    expect(reportRange("month", "2026-11", "2026-11-20").to).toBe("2026-11-20"); // current month: up to today
    expect(reportRange("month", "2027-01", "2026-11-20").value).toBe("2026-11");
    expect(reportRange(undefined, undefined, "2026-11-20").kind).toBe("day");
    expect(reportTitle({ kind: "month", value: "2026-11" })).toBe("Monthly statement — November 2026");
  });
});

describe("sales report Excel", () => {
  it("has every sheet with numbers", async () => {
    const r: SalesReport = {
      from: "2026-11-01", to: "2026-11-30",
      totals: { orders_placed: 10, orders_paid: 8, sales: 9000, products_sales: 8500, printing_sales: 300, delivery_fees: 400, discounts: 200, average_order: 1125,
        paid_by_bank: 7000, paid_by_wallet: 2000, topups_count: 2, topups_amount: 3000, cash_in: 10000, cancelled_after_payment_count: 1,
        cancelled_after_payment_bank: 500, wallet_refunds: 0 },
      by_bank: [{ bank: "CBE", account: "1000123", orders: 7, orders_amount: 7000, topups: 2, topups_amount: 3000, total: 10000 }],
      by_day: [{ day: "2026-11-01", placed: 2, paid: 1, sales: 900, bank: 900, wallet: 0, topups: 0 }],
      by_staff: [{ name: "Owner", payments: 7, amount: 7000 }],
      top_products: [{ name: "Charger", sku: "CH-1", quantity: 5, amount: 4250 }],
      cancelled_after_payment: [{ order_number: "ET-1", total: 500, method: "bank_transfer", cancelled_at: "2026-11-10T08:00:00Z", customer: "Abebe" }],
    };
    const buf = await buildSalesWorkbook(r, { business: "Abiye", title: "Monthly statement — November 2026", generatedBy: "Owner", generatedAt: new Date("2026-11-20T08:00:00Z") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "By bank account", "By day", "Verified by", "Top products", "Cancelled after payment"]);
    const s = wb.getWorksheet("Summary")!;
    const col = s.getColumn(1).values;
    expect(s.getCell(col.indexOf("MONEY IN (bank-paid orders + in-store sales + top-ups)"), 2).value).toBe(10000);
    expect(s.getCell(col.indexOf("Sales (paid orders)"), 2).value).toBe(9000);
    expect(wb.getWorksheet("By bank account")!.getCell("G2").value).toBe(10000);
  });
});
