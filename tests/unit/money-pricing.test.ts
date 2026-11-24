import { describe, expect, it } from "vitest";
import { formatETB, santim, toSantim } from "@/lib/money";
import { computeCartTotals, deliveryDiscountPercent, effectivePrice } from "@/lib/pricing/cart";
import { quotePrinting, type PrintPriceRule } from "@/lib/pricing/printing";

describe("money", () => {
  it("converts ETB to integer santim without float error", () => {
    expect(toSantim(0.1 + 0.2)).toBe(30);
    expect(toSantim("2850.00")).toBe(285000);
    expect(toSantim(19.99)).toBe(1999);
  });
  it("rejects invalid amounts", () => {
    expect(() => toSantim("abc")).toThrow();
    expect(() => santim(1.5)).toThrow();
  });
  it("formats ETB in both languages", () => {
    expect(formatETB(santim(450000))).toBe("4,500 ETB");
    expect(formatETB(santim(450050))).toBe("4,500.50 ETB");
    expect(formatETB(santim(450000), "am")).toBe("4,500 ብር");
  });
});

describe("cart totals (mirror of public.create_order)", () => {
  const lines = [
    { unitPrice: toSantim(2850), quantity: 2 },
    { unitPrice: toSantim(850), quantity: 1 },
  ];
  it("matches the database test case (6,550 + 150 delivery = 6,700)", () => {
    const t = computeCartTotals(lines, { fulfillment: "delivery", zoneFee: toSantim(150), freeDeliveryThreshold: null });
    expect(t).toEqual({ subtotal: 655000, deliveryFee: 15000, total: 670000, freeDeliveryApplied: false, deliveryDiscountPercent: 0 });
  });
  it("pickup has no delivery fee", () => {
    const t = computeCartTotals(lines, { fulfillment: "pickup", zoneFee: toSantim(150), freeDeliveryThreshold: null });
    expect(t.total).toBe(655000);
  });
  it("applies free delivery at the threshold", () => {
    const t = computeCartTotals(lines, { fulfillment: "delivery", zoneFee: toSantim(150), freeDeliveryThreshold: toSantim(6550) });
    expect(t.deliveryFee).toBe(0);
    expect(t.freeDeliveryApplied).toBe(true);
  });
  it.each([0, -1, 101, 1.5])("rejects quantity %s", (q) => {
    expect(() =>
      computeCartTotals([{ unitPrice: toSantim(10), quantity: q }], { fulfillment: "pickup", zoneFee: null, freeDeliveryThreshold: null }),
    ).toThrow(RangeError);
  });
  it("uses sale price only when lower than the regular price", () => {
    expect(effectivePrice(toSantim(3200), toSantim(2850))).toBe(285000);
    expect(effectivePrice(toSantim(3200), null)).toBe(320000);
    expect(effectivePrice(toSantim(3200), toSantim(4000))).toBe(320000);
  });
});

describe("printing quote (mirror of public.quote_printing)", () => {
  const rules: PrintPriceRule[] = [
    { colorMode: "bw", paperSize: "A4", sides: "single", pricePerPage: toSantim(3), isActive: true },
    { colorMode: "color", paperSize: "A4", sides: "double", pricePerPage: toSantim(10), isActive: true },
    { colorMode: "color", paperSize: "A3", sides: "double", pricePerPage: toSantim(30), isActive: false },
  ];
  const zero = santim(0);
  it("B/W A4 single: 10 pages × 3 copies × 3 = 90", () => {
    expect(quotePrinting(rules, zero, { colorMode: "bw", paperSize: "A4", sides: "single", pageCount: 10, copies: 3 })?.total).toBe(9000);
  });
  it("Color A4 double: 7 × 2 × 10 = 140, 4 sheets per copy", () => {
    const q = quotePrinting(rules, zero, { colorMode: "color", paperSize: "A4", sides: "double", pageCount: 7, copies: 2 });
    expect(q?.total).toBe(14000);
    expect(q?.sheetsPerCopy).toBe(4);
  });
  it("adds the service charge", () => {
    expect(quotePrinting(rules, toSantim(15), { colorMode: "bw", paperSize: "A4", sides: "single", pageCount: 10, copies: 3 })?.total).toBe(10500);
  });
  it("returns null when a quote is required", () => {
    expect(quotePrinting(rules, zero, { colorMode: "bw", paperSize: "A4", sides: "single", pageCount: null, copies: 1 })).toBeNull();
    expect(quotePrinting(rules, zero, { colorMode: "color", paperSize: "A3", sides: "double", pageCount: 5, copies: 1 })).toBeNull();
    expect(quotePrinting(rules, zero, { colorMode: "bw", paperSize: "A4", sides: "single", pageCount: 5, copies: 0 })).toBeNull();
  });
});

describe("delivery discount for more items (same rule as the database)", () => {
  const steps = [{ min_items: 3, percent: 10 }, { min_items: 6, percent: 25 }];
  it("highest step reached by the number of items", () => {
    expect(deliveryDiscountPercent(2, steps)).toBe(0);
    expect(deliveryDiscountPercent(3, steps)).toBe(10);
    expect(deliveryDiscountPercent(9, steps)).toBe(25);
    expect(deliveryDiscountPercent(9, [])).toBe(0);
  });
  it("applied to the delivery fee, rounded to the santim; not to pickup or free delivery", () => {
    const lines = [{ unitPrice: toSantim(100), quantity: 4 }];
    const t = computeCartTotals(lines, { fulfillment: "delivery", zoneFee: toSantim(155.55), freeDeliveryThreshold: null, deliveryDiscounts: steps });
    expect(t.deliveryFee).toBe(toSantim(140));
    expect(t.deliveryDiscountPercent).toBe(10);
    expect(computeCartTotals(lines, { fulfillment: "pickup", zoneFee: toSantim(150), freeDeliveryThreshold: null, deliveryDiscounts: steps }).deliveryFee).toBe(toSantim(0));
    const free = computeCartTotals(lines, { fulfillment: "delivery", zoneFee: toSantim(150), freeDeliveryThreshold: toSantim(300), deliveryDiscounts: steps });
    expect(free.deliveryFee).toBe(toSantim(0));
    expect(free.deliveryDiscountPercent).toBe(0);
  });
});
