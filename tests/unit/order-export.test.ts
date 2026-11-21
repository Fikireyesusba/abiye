import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildOrdersWorkbook, type ExportOrder } from "@/lib/admin/order-export";

const order = (n: string, status: string, pay: string, total: number): ExportOrder => ({
  order_number: n, created_at: "2026-11-19T07:30:00Z", status, payment_status: pay, customer_name: "አበበ ከበደ", customer_phone: "+251911223344",
  fulfillment_method: "delivery", city: "Addis Ababa", address_line: "Bole", subtotal_etb: total - 150, delivery_fee_etb: 150, discount_etb: 0,
  total_etb: total, payment_verified_at: pay === "verified" ? "2026-11-19T09:00:00Z" : null, promo_code: null, reference: "FT123",
  items: [{ item_type: "product", name_en: "Charger", sku: "CH-1", unit_price_etb: total - 150, quantity: 1, line_total_etb: total - 150 }],
});

describe("orders Excel export", () => {
  it("builds Summary, Orders and Items sheets with numbers, dates and Amharic intact", async () => {
    const buf = await buildOrdersWorkbook([order("ET-1", "confirmed", "verified", 1000), order("ET-2", "awaiting_payment", "unpaid", 500)],
      { business: "Abiye", from: "2026-11-01", to: "2026-11-30", filter: "All orders", generatedBy: "Owner", generatedAt: new Date("2026-11-20T08:00:00Z") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Orders", "Items"]);
    const ws = wb.getWorksheet("Orders")!;
    expect(ws.rowCount).toBe(3);
    expect(ws.getCell("E2").value).toBe("አበበ ከበደ");
    expect(ws.getCell("O2").value).toBe(1000);
    expect((ws.getCell("B2").value as Date).toISOString()).toBe("2026-11-19T08:30:00.000Z"); // shown as 08:30 Warsaw time
    const sum = wb.getWorksheet("Summary")!;
    const find = (label: string) => sum.getColumn(1).values.findIndex((v) => v === label);
    expect(sum.getCell(find("Verified revenue"), 2).value).toBe(1000);
    expect(sum.getCell(find("Orders"), 2).value).toBe(2);
    expect(wb.getWorksheet("Items")!.rowCount).toBe(3);
  });
});
