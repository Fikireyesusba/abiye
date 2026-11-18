import { describe, expect, it } from "vitest";
import { buildMessage, esc, truncate, CAPTION_LIMIT } from "@/lib/telegram/format";

const order = {
  id: 1,
  event_type: "new_order",
  attachment_bucket: "payment-receipts",
  attachment_path: "orders/x/r.png",
  payload: {
    order_id: "11111111-2222-3333-4444-555555555555",
    order_number: "ET-10025",
    customer_name: "Abebe Kebede",
    customer_phone: "+251911223344",
    items: [{ name: "Perfume", quantity: 2 }, { name: "Charger", quantity: 1 }],
    total_etb: 4500,
    transaction_reference: "FT2611ABC123",
    fulfillment_method: "delivery",
    city: "Addis Ababa",
    address_line: "Bole",
    resubmission: false,
    reference_seen_before: false,
  },
};

describe("Telegram messages", () => {
  it("matches the required new-order layout", () => {
    const { text, attachment } = buildMessage(order, "https://abiye.example");
    for (const expected of [
      "NEW CUSTOMER ORDER", "Order ID: ET-10025", "Customer: Abebe Kebede", "Phone: +251 91 122 3344", "Products:",
      "• Perfume × 2", "• Charger × 1", "Total: <b>4,500 ETB</b>", "Payment Method: Bank Transfer",
      "Transaction Reference: FT2611ABC123", "Payment Status: Pending Verification", "Delivery Address: Addis Ababa — Bole",
      'href="https://abiye.example/admin/orders/11111111-2222-3333-4444-555555555555"',
    ]) expect(text).toContain(expected);
    expect(attachment).toEqual({ bucket: "payment-receipts", path: "orders/x/r.png" });
    expect(text.length).toBeLessThanOrEqual(CAPTION_LIMIT);
  });

  it("escapes customer-controlled text (no HTML/link injection)", () => {
    const evil = { ...order, payload: { ...order.payload, customer_name: '<a href="https://phish.example">Click</a> & <b>', items: [{ name: "<i>x</i>", quantity: 1 }] } };
    const { text } = buildMessage(evil, "");
    expect(text).not.toContain("<a href=\"https://phish");
    expect(text).toContain("&lt;a href=&quot;https://phish.example&quot;&gt;Click&lt;/a&gt; &amp; &lt;b&gt;");
    expect(text).toContain("• &lt;i&gt;x&lt;/i&gt; × 1");
    expect(esc("<script>")).toBe("&lt;script&gt;");
  });

  it("flags resubmissions and reused transaction references", () => {
    const { text } = buildMessage({ ...order, event_type: "payment_resubmitted", payload: { ...order.payload, resubmission: true, reference_seen_before: true } }, "");
    expect(text).toContain("PAYMENT RESUBMITTED");
    expect(text).toContain("also used on another order");
  });

  it("formats printing requests (priced and needing a quote)", () => {
    const base = { id: 2, event_type: "printing_request", attachment_bucket: null, attachment_path: null };
    const priced = buildMessage({ ...base, payload: { job_id: "j", job_number: "PR-10001", customer_name: "M", customer_phone: "+251911000000", color_mode: "color", paper_size: "A4", sides: "double", copies: 2, page_count: 3, total_etb: 60, file_count: 1 } }, "https://a.b");
    expect(priced.text).toContain("NEW PRINTING REQUEST");
    expect(priced.text).toContain("Colour · A4 · double-sided · 2 copies");
    expect(priced.text).toContain("60 ETB");
    expect(priced.text).toContain("/admin/printing/j");
    const quote = buildMessage({ ...base, payload: { job_number: "PR-10002", copies: 1, page_count: null, total_etb: null } }, "");
    expect(quote.text).toContain("Needs a quote");
  });

  it("cancellation of a paid order warns about a refund", () => {
    const { text } = buildMessage({ id: 3, event_type: "order_cancelled", attachment_bucket: null, attachment_path: null, payload: { order_number: "ET-1", note: "Out of stock", refund_required: true } }, "");
    expect(text).toContain("ORDER CANCELLED");
    expect(text).toContain("refund is required");
  });

  it("truncates long messages on a line boundary", () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const out = truncate(long, 1024);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.endsWith("\n…")).toBe(true);
  });
});
