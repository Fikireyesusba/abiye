import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { buildArchiveEmail } = await import("@/lib/email/archive");

describe("receipt archive email", () => {
  it("summarises a rejected payment with reason, reviewer and Warsaw time; escapes HTML", () => {
    const m = buildArchiveEmail({
      kind: "order_payment", result: "rejected", number: "ET-1042", amount_etb: 1850, order_total_etb: 1850, reference: "FT26112ABC",
      customer_name: "<b>Abebe</b>", customer_phone: "+251911223344", customer_email: "a@example.com", bank_name: "CBE", account_number: "1000123",
      submitted_at: "2026-11-20T06:00:00Z", decided_at: "2026-11-20T07:30:00Z", decided_by: "Owner", reason: "Not in bank statement",
      receipt_name: "receipt.jpg", receipt_mime: "image/jpeg", receipt_sha256: "ab".repeat(32),
    }, "Abiye");
    expect(m.subject).toBe("[Receipt archive] REJECTED · ET-1042 · 1,850.00 ETB · FT26112ABC");
    expect(m.filename).toBe("payment-ET-1042-rejected.jpg");
    expect(m.html).toContain("&lt;b&gt;Abebe&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Abebe</b>");
    expect(m.text).toContain("Reason: Not in bank statement");
    expect(m.text).toContain("Decided: 2026-11-20 08:30 (Warsaw time)");
    expect(m.text).toContain("Decided by: Owner");
    expect(m.text).toContain("(attached)");
  });

  it("names top-up receipts and notes a missing file", () => {
    const m = buildArchiveEmail({ kind: "wallet_topup", result: "verified", number: "TU-7", amount_etb: 500, receipt_mime: "application/pdf" }, "Abiye", true);
    expect(m.filename).toBe("topup-TU-7-verified.pdf");
    expect(m.subject).toContain("VERIFIED · TU-7 · 500.00 ETB");
    expect(m.text).toContain("not attached");
    expect(m.text).not.toContain("Order total");
  });
});
