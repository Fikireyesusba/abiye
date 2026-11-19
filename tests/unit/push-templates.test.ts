import { describe, expect, it } from "vitest";
import { buildPush } from "@/lib/push/templates";

const EVENTS = [
  "customer_order_placed", "customer_order_confirmed", "customer_order_payment_rejected", "customer_order_ready_for_pickup",
  "customer_order_out_for_delivery", "customer_order_completed", "customer_order_cancelled", "customer_order_expired",
  "customer_printing_quote_ready", "customer_printing_ready",
];
const payload = { order_id: "11111111-1111-1111-1111-111111111111", order_number: "ET-10042", job_id: "22222222-2222-2222-2222-222222222222", job_number: "PR-7", total_etb: 1530 };

describe("phone notification texts", () => {
  it("every event has a short title, body and an in-app link, in both languages", () => {
    for (const e of EVENTS) for (const l of ["en", "am"] as const) {
      const m = buildPush(e, payload, l, "Abiye");
      expect(m, `${e}/${l}`).not.toBeNull();
      expect(m!.title.length).toBeLessThanOrEqual(60);
      expect(m!.body.length).toBeLessThanOrEqual(160);
      expect(m!.url.startsWith("/")).toBe(true);
    }
  });
  it("uses the device language", () => {
    expect(buildPush("customer_order_confirmed", payload, "en", "Abiye")!.title).toContain("Payment received");
    expect(buildPush("customer_order_confirmed", payload, "am", "አብዬ")!.title).toContain("ክፍያ ተረጋግጧል");
  });
  it("links orders and printing jobs", () => {
    expect(buildPush("customer_order_placed", payload, "en", "Abiye")!.url).toBe("/order-success/11111111-1111-1111-1111-111111111111");
    expect(buildPush("customer_printing_ready", payload, "en", "Abiye")!.url).toBe("/printing/jobs/22222222-2222-2222-2222-222222222222");
  });
  it("ignores unknown events and missing links", () => {
    expect(buildPush("other", payload, "en", "Abiye")).toBeNull();
    expect(buildPush("customer_order_confirmed", {}, "en", "Abiye")).toBeNull();
  });
});
