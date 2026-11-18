"use server";
import type { AppErrorCode } from "@/lib/errors";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { normalizeTrackingCode, sha256Hex } from "@/lib/security/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface TrackedOrder {
  order_number: string;
  status: string;
  payment_status: string;
  fulfillment_method: string;
  total_etb: number;
  created_at: string;
  items: { name_en: string; name_am: string; quantity: number }[];
  history: { to_status: string; created_at: string }[];
}

export type TrackState = {
  result?: TrackedOrder;
  error?: AppErrorCode;
  submitted?: number;
  /** Echo of the user's own input so the form keeps it after React resets the form. */
  values?: { orderNumber: string; trackingCode: string };
};

/**
 * Order lookup by order number + tracking code. Deliberately returns NO
 * personal data (no name, phone or address). Rate-limited per IP and per
 * order number; failures are indistinguishable ("order_not_found").
 */
export async function trackOrder(_prev: TrackState, formData: FormData): Promise<TrackState> {
  const submitted = Date.now();
  const rawNumber = String(formData.get("orderNumber") ?? "").slice(0, 20);
  const rawCode = String(formData.get("trackingCode") ?? "").slice(0, 20);
  const values = { orderNumber: rawNumber, trackingCode: rawCode };
  const orderNumber = rawNumber.trim().toUpperCase().replace(/\s+/g, "");
  const code = normalizeTrackingCode(rawCode);
  const numberOk = /^ET-?\d{5,9}$/.test(orderNumber);
  const normalizedNumber = numberOk ? orderNumber.replace(/^ET-?/, "ET-") : "";

  const ip = await clientIpKey();
  const checks: Array<[string, number, number]> = [[`track:ip:${ip}`, 10, 900]];
  if (normalizedNumber) checks.push([`track:order:${normalizedNumber}`, 5, 900]);
  if (!(await rateLimitAll(checks))) return { error: "rate_limited", submitted, values };
  if (!numberOk || !code) return { error: "order_not_found", submitted, values };

  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select(
      `order_number, status, payment_status, fulfillment_method, total_etb, created_at,
       items:order_items ( name_en, name_am, quantity ), history:order_status_history ( to_status, created_at )`,
    )
    .eq("order_number", normalizedNumber)
    .eq("tracking_code_hash", sha256Hex(code))
    .maybeSingle();
  if (error) {
    console.error("[track] lookup failed:", error.message);
    return { error: "unexpected", submitted, values };
  }
  if (!data) return { error: "order_not_found", submitted, values };
  const result = data as unknown as TrackedOrder;
  result.history.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { result, submitted, values };
}
