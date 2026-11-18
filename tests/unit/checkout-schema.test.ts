import { describe, expect, it } from "vitest";
import { checkoutSchema, paymentSubmissionSchema } from "@/lib/validation/checkout";

const base = {
  idempotencyKey: "0b8a2a3c-5f0e-4d7e-9a43-1c2b3d4e5f60",
  fullName: "  Abebe   Kebede ",
  phone: "0911 22 33 44",
  fulfillment: "delivery",
  deliveryZoneId: "40000000-0000-0000-0000-000000000001",
  addressLine: "Bole, House 123",
  items: [{ type: "product", productId: "20000000-0000-0000-0000-000000000001", quantity: 2 }],
};

describe("checkout validation", () => {
  it("normalizes a valid checkout", () => {
    const r = checkoutSchema.parse(base);
    expect(r.phone).toBe("+251911223344");
    expect(r.fullName).toBe("Abebe Kebede");
    expect(r.locale).toBe("en");
  });
  it("never accepts client-side prices (unknown keys are stripped)", () => {
    const r = checkoutSchema.parse({ ...base, total: 1, items: [{ ...base.items[0], price: 1 }] });
    expect(r).not.toHaveProperty("total");
    expect(r.items[0]).not.toHaveProperty("price");
  });
  it("requires zone and address for delivery, but not for pickup", () => {
    expect(checkoutSchema.safeParse({ ...base, deliveryZoneId: undefined }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, addressLine: undefined }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, fulfillment: "pickup", deliveryZoneId: undefined, addressLine: undefined }).success).toBe(true);
  });
  it.each([
    ["invalid phone", { phone: "12345" }],
    ["empty basket", { items: [] }],
    ["zero quantity", { items: [{ ...base.items[0], quantity: 0 }] }],
    ["huge quantity", { items: [{ ...base.items[0], quantity: 1000 }] }],
    ["fractional quantity", { items: [{ ...base.items[0], quantity: 1.5 }] }],
    ["bad product id", { items: [{ ...base.items[0], productId: "1 or 1=1" }] }],
    ["one-letter name", { fullName: "A" }],
    ["bad idempotency key", { idempotencyKey: "abc" }],
  ])("rejects %s", (_, patch) => {
    expect(checkoutSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it("keeps markup as inert text (React escapes on render)", () => {
    const r = checkoutSchema.parse({ ...base, fullName: "<img src=x onerror=alert(1)>" });
    expect(r.fullName).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("payment submission validation", () => {
  const ok = { orderId: base.idempotencyKey, accessToken: "a".repeat(43) };
  it("accepts optional transaction reference", () => {
    expect(paymentSubmissionSchema.parse({ ...ok, transactionReference: "" }).transactionReference).toBeUndefined();
    expect(paymentSubmissionSchema.parse({ ...ok, transactionReference: " FT2611ABC123 " }).transactionReference).toBe("FT2611ABC123");
  });
  it("rejects malformed tokens and references", () => {
    expect(paymentSubmissionSchema.safeParse({ ...ok, accessToken: "short" }).success).toBe(false);
    expect(paymentSubmissionSchema.safeParse({ ...ok, transactionReference: "<script>" }).success).toBe(false);
  });
});
