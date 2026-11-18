import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPages } from "@/lib/printing/page-count";

async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

describe("printing page count", () => {
  it("counts PDF pages", async () => {
    expect(await countPages(await pdf(1), "application/pdf")).toBe(1);
    expect(await countPages(await pdf(23), "application/pdf")).toBe(23);
  });
  it("treats images as one page", async () => {
    expect(await countPages(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(1);
  });
  it("returns null (manual quote) for DOCX", async () => {
    expect(await countPages(new Uint8Array([0x50, 0x4b, 3, 4]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
  });
  it("returns null for a corrupt PDF instead of throwing", async () => {
    const bad = new TextEncoder().encode("%PDF-1.7\n garbage garbage garbage");
    expect(await countPages(bad, "application/pdf")).toBeNull();
  });

});
