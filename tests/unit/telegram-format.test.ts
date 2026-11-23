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
    user_id: "482915",
  },
};

describe("Telegram messages", () => {
  it("matches the required new-order layout", () => {
    const { text, attachment } = buildMessage(order, "https://abiye.example");
    for (const expected of [
      "NEW CUSTOMER ORDER", "Order ID: ET-10025", "User ID: 482915", "Products:",
      "• Perfume × 2", "• Charger × 1", "Total: <b>4,500 ETB</b>", "Payment Method: Bank Transfer",
      "Transaction Reference: FT2611ABC123", "Payment Status: Pending Verification", "Delivery Address: Addis Ababa — Bole",
      'href="https://abiye.example/admin/orders/11111111-2222-3333-4444-555555555555"',
    ]) expect(text).toContain(expected);
    expect(text).not.toContain("Abebe");
    expect(text).not.toContain("91 122");
    expect(text).toContain("👉 <b>Suggested action:</b> Find this amount and reference in the bank statement");
    expect(text.indexOf("Suggested action")).toBeLessThan(text.indexOf("Open in admin"));
    expect(attachment).toEqual({ bucket: "payment-receipts", path: "orders/x/r.png" });
    expect(text.length).toBeLessThanOrEqual(CAPTION_LIMIT);
  });

  it("escapes customer-controlled text (no HTML/link injection)", () => {
    const evil = { ...order, payload: { ...order.payload, transaction_reference: '<a href="https://phish.example">Click</a> & <b>', items: [{ name: "<i>x</i>", quantity: 1 }] } };
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

describe("Telegram activity feed", () => {
  const row = (event_type: string, payload: Record<string, unknown>) => ({ id: 1, event_type, payload, attachment_bucket: null, attachment_path: null });
  it("every message carries its service and event name", () => {
    const m = buildMessage(row("new_order", { order_number: "ET-1", items: [], total_etb: 100 }), "https://shop.example");
    expect(m.text.split("\n")[1]).toBe("<i>Service: Payments · Type: Receipt uploaded — verify payment</i>");
  });
  it("security event: what, email, network, device, repeats, escaped", () => {
    const m = buildMessage(row("security_event", { kind: "admin_mfa_failed", email: "x<y>@example.com", network: "abcdef1234", device: "curl/8",
      repeats: 4, details: { where: "data_reset" }, at: "2026-11-20T07:00:00Z" }), "https://shop.example");
    expect(m.text).toContain("SECURITY: WRONG TWO-STEP CODE");
    expect(m.text).toContain("Service: Admin sign-in · Type: Wrong two-step code");
    expect(m.text).toContain("x&lt;y&gt;@example.com");
    expect(m.text).toContain("× 4");
    expect(m.text).toContain("Where: data_reset");
    expect(m.text).toContain("2026-11-20 08:00 (Warsaw time)");
  });
  it("printing document: file, print options and customer, with the file attached", () => {
    const m = buildMessage({ ...row("printing_document", { job_id: "j1", job_number: "PR-10001", file_name: "thesis<1>.pdf", n: 1, of: 2, pages: 12,
      color_mode: "bw", paper_size: "A4", sides: "single", copies: 3, customer: "Abebe", phone: "+251911223344", fulfillment: "pickup" }),
      attachment_bucket: "printing-files", attachment_path: "jobs/j1/a.pdf" }, "https://shop.example");
    expect(m.text).toContain("PRINT — PAID");
    expect(m.text).toContain("file 1 of 2");
    expect(m.text).toContain("thesis&lt;1&gt;.pdf");
    expect(m.text).toContain("Black &amp; white · A4 · single-sided · 3 copies");
    expect(m.attachment).toEqual({ bucket: "printing-files", path: "jobs/j1/a.pdf" });
  });
  it("high-risk alert, admin action and notification copy", () => {
    const a = buildMessage(row("security_alert", { email: "bad@example.com", score: 9, is_staff: true, last_kind: "admin_login_failed" }), "");
    expect(a.text).toContain("SECURITY ALERT");
    expect(a.text).toContain("STAFF account");
    const b = buildMessage(row("admin_action", { action: "email_blocked", entity_type: "security", entity_id: "bad@example.com", actor: "Owner", role: "super_admin", metadata: { reason: "spam" } }), "");
    expect(b.text).toContain("ADMIN ACTION: EMAIL BLOCKED");
    expect(b.text).toContain("Service: Security · Type: Email blocked");
    expect(b.text).toContain("By: Owner (super admin)");
    expect(b.text).toContain("Reason: spam");
    const c = buildMessage(row("notification_copy", { channel: "push", event: "customer_order_confirmed", status: "dead", attempts: 4, error: "HTTP 410", to: "c@example.com", order_number: "ET-9" }), "");
    expect(c.text).toContain("FAILED: PAYMENT CONFIRMED");
    expect(c.text).toContain("Service: Phone notification · Type: Payment confirmed");
    expect(c.text).toContain("Error: HTTP 410");
  });
  it("promotion alerts and Excel copies", () => {
    const base = { title: "Holiday", code: "HOLI", discount: "15% off", audience: "Every customer", applies_to: "All products", active: true, by_user_id: "123456", at: "2026-11-23T10:00:00Z" };
    const a = buildMessage(row("promotion_alert", { ...base, change: "created" }), "https://abiye.example");
    for (const t of ["PROMOTION: CREATED", "Service: Promotions · Type: Created", "Action by User ID: 123456", "Code: HOLI", "Discount: 15% off", "Status: Active", "/admin/promotions"]) expect(a.text).toContain(t);
    const r = buildMessage(row("promotion_alert", { ...base, change: "revoked", active: false, reason: "Ended early" }), "");
    expect(r.text).toContain("PROMOTION: REVOKED");
    expect(r.text).toContain("Reason: Ended early");
    const u = buildMessage(row("promotion_alert", { ...base, change: "used", user_id: "654321", order_number: "ET-10050", original_etb: 1000, discount_etb: 150, total_etb: 850, payment_method: "wallet" }), "");
    for (const t of ["PROMOTION: CODE USED", "User ID: 654321", "Order: ET-10050", "Original price: 1,000 ETB", "Discount given: 150 ETB", "Price paid: <b>850 ETB</b>", "Paid with: Balance"]) expect(u.text).toContain(t);
    const x = buildMessage({ ...row("excel_export", { title: "Promotion uses", file_name: "promotions-2026-11-01_to_2026-11-23.xlsx", rows: 3, by_user_id: "123456", at: "2026-11-23T10:00:00Z" }),
      attachment_bucket: "excel-exports", attachment_path: "11111111-1111-1111-1111-111111111111.xlsx" }, "");
    for (const t of ["EXCEL EXPORT", "Service: Exports · Type: Excel: Promotion uses", "Action by User ID: 123456", "Rows: 3", "Suggested action"]) expect(x.text).toContain(t);
    expect(x.attachment).toEqual({ bucket: "excel-exports", path: "11111111-1111-1111-1111-111111111111.xlsx" });
    expect(x.text.length).toBeLessThanOrEqual(CAPTION_LIMIT);
  });
  it("printing order payment: own title, orders & payments group", () => {
    const m = buildMessage({ ...order, payload: { ...order.payload, printing: true } }, "");
    expect(m.text).toContain("🖨 <b>PRINTING ORDER — PAYMENT TO VERIFY</b>");
    expect(m.text).toContain("Service: Printing payments · Type: Receipt uploaded — verify payment");
  });
});
