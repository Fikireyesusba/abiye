/**
 * Mirror of the state machine in public.admin_update_order_status() so the UI
 * only offers valid buttons. The database remains the authority.
 */
export type OrderStatus =
  | "awaiting_payment" | "pending_verification" | "payment_rejected" | "confirmed" | "processing"
  | "ready_for_pickup" | "out_for_delivery" | "completed" | "cancelled" | "expired";

export function nextStatuses(status: OrderStatus, fulfillment: "delivery" | "pickup"): OrderStatus[] {
  switch (status) {
    case "confirmed":
      return ["processing", "cancelled"];
    case "processing":
      return [fulfillment === "pickup" ? "ready_for_pickup" : "out_for_delivery", "cancelled"];
    case "ready_for_pickup":
      return ["completed"];
    case "out_for_delivery":
      return ["completed", "processing"];
    case "awaiting_payment":
    case "payment_rejected":
    case "pending_verification":
      return ["cancelled"];
    default:
      return [];
  }
}

export const ORDER_STATUSES: OrderStatus[] = [
  "awaiting_payment", "pending_verification", "payment_rejected", "confirmed", "processing",
  "ready_for_pickup", "out_for_delivery", "completed", "cancelled", "expired",
];
