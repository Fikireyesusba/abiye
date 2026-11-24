import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** What an order is made of, for staff: every line with its price, delivery (and its discount), promo code, total. */
export interface OrderBreakdown {
  items: { name: string; quantity: number; unit_etb: number; line_etb: number }[];
  subtotal_etb: number;
  delivery_fee_etb: number;
  /** The city's full delivery price (before the bigger-purchase discount / free delivery); null for pickup at the shop. */
  delivery_full_etb: number | null;
  /** Percent taken off the delivery price (bigger-purchase discount or free delivery). */
  delivery_discount_pct: number;
  promo_code: string | null;
  promo_discount_etb: number;
  total_etb: number;
  fulfillment: "delivery" | "pickup";
  city: string | null;
  partner_shop: string | null;
}

export function deliveryDiscountPct(fee: number, full: number | null): number {
  if (!full || full <= 0 || fee >= full) return 0;
  return Math.round((1 - fee / full) * 100);
}

/** Read with the caller's client (staff RLS) or the server's secret client (Telegram dispatcher). */
export async function loadOrderBreakdown(db: SupabaseClient<Database>, orderId: string): Promise<OrderBreakdown | null> {
  const { data: o } = await db.from("orders")
    .select("subtotal_etb, delivery_fee_etb, delivery_fee_full_etb, discount_etb, total_etb, fulfillment_method, city, partner_snapshot, promotion:promotions(code), items:order_items(name_en, quantity, unit_price_etb, line_total_etb, created_at)")
    .eq("id", orderId).maybeSingle();
  if (!o) return null;
  const items = [...(o.items ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const fee = Number(o.delivery_fee_etb);
  const full = o.delivery_fee_full_etb === null ? null : Number(o.delivery_fee_full_etb);
  const promo = o.promotion as { code?: string | null } | null;
  return {
    items: items.map((i) => ({ name: i.name_en, quantity: i.quantity, unit_etb: Number(i.unit_price_etb), line_etb: Number(i.line_total_etb) })),
    subtotal_etb: Number(o.subtotal_etb),
    delivery_fee_etb: fee,
    delivery_full_etb: full,
    delivery_discount_pct: deliveryDiscountPct(fee, full),
    promo_code: promo?.code ?? null,
    promo_discount_etb: Number(o.discount_etb),
    total_etb: Number(o.total_etb),
    fulfillment: o.fulfillment_method,
    city: o.city,
    partner_shop: (o.partner_snapshot as { name?: string } | null)?.name ?? null,
  };
}
