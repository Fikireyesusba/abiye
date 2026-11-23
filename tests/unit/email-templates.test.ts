import { describe, expect, it } from "vitest";
import { buildCustomerEmail, type EmailContext } from "@/lib/email/templates";

const ctx: EmailContext = { appUrl: "https://shop.example", business: { en: "Abiye", am: "አብዬ" }, phone: "+251911223344", address: { en: "Bole, Addis Ababa", am: "ቦሌ" } };
const order = { order_id: "11111111-1111-1111-1111-111111111111", order_number: "ET-10042", total_etb: 1530, fulfillment: "pickup" };
const EVENTS = [
  "customer_order_placed", "customer_order_confirmed", "customer_order_payment_rejected", "customer_order_ready_for_pickup",
  "customer_order_out_for_delivery", "customer_order_completed", "customer_order_cancelled", "customer_order_expired",
  "customer_printing_quote_ready", "customer_printing_ready",
];

describe("customer emails", () => {
  it("builds every event in English only (no Amharic since 2026-11-23) with a link", () => {
    for (const event_type of EVENTS) {
      const e = buildCustomerEmail({ event_type, payload: { ...order, job_id: "22222222-2222-2222-2222-222222222222", job_number: "PR-7" } }, ctx);
      expect(e, event_type).not.toBeNull();
      expect(e!.html).toContain('lang="en"');
      expect(e!.html).not.toContain('lang="am"');
      expect((e!.html + e!.subject + e!.text).match(/.{0,30}[\u1200-\u137F]+/)?.[0] ?? null, event_type).toBeNull();
      expect(e!.text).toContain("https://shop.example/");
      expect(e!.subject.length).toBeLessThanOrEqual(200);
    }
  });
  it("order placed: amount, bank details, deadline and receipt link", () => {
    const e = buildCustomerEmail({ event_type: "customer_order_placed", payload: { ...order, payment_due_at: "2026-11-20T09:00:00Z",
      bank: { bank_name: "CBE", account_holder: "Abiye Trading", account_number: "1000123456789" } } }, ctx)!;
    expect(e.subject).toContain("ET-10042");
    expect(e.subject).toContain("1,530");
    expect(e.html).toContain("1000123456789");
    expect(e.html).toContain("Abiye Trading");
    expect(e.html).toContain("/order-success/11111111-1111-1111-1111-111111111111");
    expect(e.text).toContain("10:00"); // 09:00 UTC = 10:00 Warsaw time (winter)
  });
  it("escapes everything that comes from data", () => {
    const e = buildCustomerEmail({ event_type: "customer_order_payment_rejected", payload: { ...order, note: '<script>alert("x")</script> & co' } }, ctx)!;
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.text).toContain('<script>alert("x")</script> & co'); // plain text is not HTML
  });
  it("unknown events are ignored", () => {
    expect(buildCustomerEmail({ event_type: "something_else", payload: {} }, ctx)).toBeNull();
  });
});

describe("stock emails", () => {
  const product = { product_id: "33333333-3333-3333-3333-333333333333", name: "Phone charger <fast>", name_am: "የስልክ ቻርጀር", sku: "CH-1", slug: "phone-charger", stock: 3, threshold: 5 };
  it("back in stock: English with a product link, escaped", () => {
    const e = buildCustomerEmail({ event_type: "customer_back_in_stock", payload: product }, ctx)!;
    expect(e.subject).toContain("Back in stock");
    expect(e.html).not.toContain('lang="am"');
    expect(e.html).toContain("https://shop.example/products/phone-charger");
    expect(e.html).toContain("Phone charger &lt;fast&gt;");
    expect(e.html).toContain("asked us to");
  });
  it("staff low-stock / sold-out alerts: English, admin link, staff footer", () => {
    const low = buildCustomerEmail({ event_type: "staff_low_stock", payload: product }, ctx)!;
    expect(low.subject).toBe("Low stock: Phone charger <fast> (3 left)"); // subjects are plain text
    expect(low.html).not.toContain('lang="am"');
    expect(low.html).toContain("/admin/products/33333333-3333-3333-3333-333333333333");
    expect(low.html).toContain("Staff alert");
    const out = buildCustomerEmail({ event_type: "staff_out_of_stock", payload: { ...product, stock: 0 } }, ctx)!;
    expect(out.subject).toContain("Sold out");
  });
});

describe("personal discount email", () => {
  it("shows the code, discount, minimum, expiry and note (English)", () => {
    const e = buildCustomerEmail({ event_type: "customer_promo_gift", payload: {
      code: "MEKDES-7K2Q", discount_type: "fixed", discount_value: 150, min_order_etb: 1000, ends_at: "2026-12-04T09:00:00Z",
      note: "Thank you <3", name: "Mekdes Alemu" } }, ctx)!;
    expect(e.subject).toBe("A discount just for you: MEKDES-7K2Q");
    expect(e.html).toContain("MEKDES-7K2Q");
    expect(e.html).toContain("Mekdes, here is a discount just for you");
    expect(e.html).toContain("Thank you &lt;3");
    expect(e.html).not.toContain('lang="am"');
    expect(e.text).toMatch(/orders from 1,000/);
    expect(e.text).toContain("Valid until");
    const pct = buildCustomerEmail({ event_type: "customer_promo_gift", payload: { code: "GIFT-AB23", discount_type: "percent", discount_value: 10, min_order_etb: 0 } }, ctx)!;
    expect(pct.html).toContain("10% off");
    expect(pct.text).not.toContain("orders from");
  });
});
