import { addSantim, mulSantim, santim, type Santim } from "@/lib/money";

/**
 * Cart totals for DISPLAY. The authoritative calculation is public.create_order()
 * in the database, which re-reads prices, stock and delivery fees and ignores
 * anything the browser sends. Keep this logic identical to that function.
 */
export interface CartLineInput {
  unitPrice: Santim;
  quantity: number;
}

export interface CartTotals {
  subtotal: Santim;
  deliveryFee: Santim;
  total: Santim;
  freeDeliveryApplied: boolean;
  /** Discount on the delivery fee for many items (0 = none). */
  deliveryDiscountPercent: number;
}

export interface DeliveryDiscount {
  min_amount_etb: number;
  percent: number;
}

/** Highest step reached by this purchase amount (same rule as private.delivery_discount_pct_for_amount in the database). */
export function deliveryDiscountPercent(subtotal: Santim, steps: readonly DeliveryDiscount[] = []): number {
  return steps.reduce((best, s) => (subtotal >= Math.round(s.min_amount_etb * 100) ? Math.max(best, Math.min(Math.max(s.percent, 0), 100)) : best), 0);
}

export const MAX_LINE_QUANTITY = 100;
export const MAX_CART_LINES = 50;

export function computeCartTotals(
  lines: readonly CartLineInput[],
  options: { fulfillment: "delivery" | "pickup"; zoneFee: Santim | null; freeDeliveryThreshold: Santim | null; deliveryDiscounts?: readonly DeliveryDiscount[] },
): CartTotals {
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_LINE_QUANTITY) {
      throw new RangeError(`Invalid quantity: ${l.quantity}`);
    }
  }
  const subtotal = addSantim(...lines.map((l) => mulSantim(l.unitPrice, l.quantity)));
  let deliveryFee = santim(0);
  let freeDeliveryApplied = false;
  const pct = deliveryDiscountPercent(subtotal, options.deliveryDiscounts);
  if (options.fulfillment === "delivery" && options.zoneFee !== null) {
    if (options.freeDeliveryThreshold !== null && subtotal >= options.freeDeliveryThreshold) {
      freeDeliveryApplied = true;
    } else {
      // Same rounding as the database: to the santim.
      deliveryFee = santim(Math.round((options.zoneFee * (100 - pct)) / 100));
    }
  }
  return { subtotal, deliveryFee, total: addSantim(subtotal, deliveryFee), freeDeliveryApplied, deliveryDiscountPercent: freeDeliveryApplied ? 0 : pct };
}

/** Effective unit price: sale price when present and lower, otherwise regular price. */
export function effectivePrice(price: Santim, salePrice: Santim | null): Santim {
  return salePrice !== null && salePrice > 0 && salePrice < price ? salePrice : price;
}
