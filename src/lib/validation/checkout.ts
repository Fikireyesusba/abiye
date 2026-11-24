import { z } from "zod";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "@/lib/pricing/cart";
import { normalizeEthiopianPhone } from "./phone";

/** Strip control characters and collapse whitespace (XSS is handled by React escaping; this keeps data clean). */
const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min).max(max));

export const ethiopianPhoneSchema = z
  .string()
  .max(25)
  .transform((v, ctx) => {
    const n = normalizeEthiopianPhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return n;
  });

export const cartItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("product"),
    productId: z.guid(),
    quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
  }),
  z.object({
    type: z.literal("printing"),
    printingJobId: z.guid(),
    // Optional: a signed-in owner may pay for their job without the private-link token.
    accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  }),
]);

/** Promo code as typed by the customer (validity and discount are decided by the database). */
export const promotionCodeSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/);

export const checkoutSchema = z
  .object({
    idempotencyKey: z.guid(),
    locale: z.enum(["en", "am"]).default("en"),
    fullName: cleanText(2, 120),
    phone: ethiopianPhoneSchema,
    fulfillment: z.enum(["delivery", "pickup"]),
    deliveryZoneId: z.guid().optional(),
    /** Pickup at a partner shop (fulfillment "pickup"). */
    partnerShopId: z.guid().optional(),
    addressLine: cleanText(3, 300).optional(),
    instructions: cleanText(0, 500).optional(),
    items: z.array(cartItemSchema).min(1).max(MAX_CART_LINES),
    acceptTerms: z.literal(true, { message: "terms_required" }),
    promotionCode: promotionCodeSchema.optional(),
    paymentMethod: z.enum(["bank_transfer", "wallet"]).default("bank_transfer"),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === "delivery") {
      if (!v.deliveryZoneId) ctx.addIssue({ code: "custom", path: ["deliveryZoneId"], message: "invalid_delivery_zone" });
      if (!v.addressLine) ctx.addIssue({ code: "custom", path: ["addressLine"], message: "invalid_address" });
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const paymentSubmissionSchema = z.object({
  orderId: z.guid(),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  transactionReference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/_ -]{3,60}$/, "invalid_reference")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
