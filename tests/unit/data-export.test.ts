import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { EXPORT_AREAS, buildFullExport } from "@/lib/admin/data-export";

describe("export everything", () => {
  it("covers exactly the areas the database exports", () => {
    const sql = readFileSync("supabase/migrations/20261120000034_data_export_reset.sql", "utf8");
    const list = sql.match(/select array\[([\s\S]*?)\]/)![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1));
    expect(EXPORT_AREAS.map((a) => a.area)).toEqual(list);
    for (const a of EXPORT_AREAS) expect(a.sheet.length).toBeLessThanOrEqual(31);
    expect(new Set(EXPORT_AREAS.map((a) => a.sheet)).size).toBe(EXPORT_AREAS.length);
  });

  it("one sheet per area plus About; objects as JSON, long text cut", async () => {
    const buf = await buildFullExport([
      { sheet: "Orders", rows: [{ id: "a", total_etb: 850, bank_snapshot: { bank_name: "CBE" } }, { id: "b", note: "x".repeat(40000) }] },
      { sheet: "Reviews", rows: [] },
    ], { business: "Abiye", generatedBy: "Owner", generatedAt: new Date("2026-11-20T08:00:00Z") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["About", "Orders", "Reviews"]);
    const o = wb.getWorksheet("Orders")!;
    expect(o.getRow(1).values).toEqual([undefined, "id", "total_etb", "bank_snapshot", "note"]);
    expect(o.getCell("B2").value).toBe(850);
    expect(o.getCell("C2").value).toBe('{"bank_name":"CBE"}');
    expect(String(o.getCell("D3").value).length).toBeLessThanOrEqual(32001);
    expect(wb.getWorksheet("Reviews")!.getCell("A1").value).toBe("(no rows)");
  });
});
