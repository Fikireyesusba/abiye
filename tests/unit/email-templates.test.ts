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
  it("builds every event in English and Amharic with a link", () => {
    for (const event_type of EVENTS) {
      const e = buildCustomerEmail({ event_type, payload: { ...order, job_id: "22222222-2222-2222-2222-222222222222", job_number: "PR-7" } }, ctx);
      expect(e, event_type).not.toBeNull();
      expect(e!.html).toContain('lang="en"');
      expect(e!.html).toContain('lang="am"');
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
    expect(e.text).toContain("12:00"); // 09:00 UTC = 12:00 Addis Ababa
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
