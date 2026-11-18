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
}

export const MAX_LINE_QUANTITY = 100;
export const MAX_CART_LINES = 50;

export function computeCartTotals(
  lines: readonly CartLineInput[],
  options: { fulfillment: "delivery" | "pickup"; zoneFee: Santim | null; freeDeliveryThreshold: Santim | null },
): CartTotals {
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_LINE_QUANTITY) {
      throw new RangeError(`Invalid quantity: ${l.quantity}`);
    }
  }
  const subtotal = addSantim(...lines.map((l) => mulSantim(l.unitPrice, l.quantity)));
  let deliveryFee = santim(0);
  let freeDeliveryApplied = false;
  if (options.fulfillment === "delivery" && options.zoneFee !== null) {
    if (options.freeDeliveryThreshold !== null && subtotal >= options.freeDeliveryThreshold) {
      freeDeliveryApplied = true;
    } else {
      deliveryFee = options.zoneFee;
    }
  }
  return { subtotal, deliveryFee, total: addSantim(subtotal, deliveryFee), freeDeliveryApplied };
}

/** Effective unit price: sale price when present and lower, otherwise regular price. */
export function effectivePrice(price: Santim, salePrice: Santim | null): Santim {
  return salePrice !== null && salePrice > 0 && salePrice < price ? salePrice : price;
}
