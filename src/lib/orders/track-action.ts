"use server";
import type { AppErrorCode } from "@/lib/errors";
import { getCustomerUser } from "@/lib/account/session";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  values?: { orderNumber: string };
};

/**
 * Order lookup by order number, for the SIGNED-IN customer's own orders only
 * (the query runs with the customer's session, so database rules also limit it
 * to their orders). Rate-limited per account and IP; another customer's order
 * number gives the same "order_not_found" as a number that does not exist.
 */
export async function trackOrder(_prev: TrackState, formData: FormData): Promise<TrackState> {
  const submitted = Date.now();
  const rawNumber = String(formData.get("orderNumber") ?? "").slice(0, 20);
  const values = { orderNumber: rawNumber };
  const user = await getCustomerUser();
  if (!user) return { error: "login_required", submitted, values };
  const orderNumber = rawNumber.trim().toUpperCase().replace(/\s+/g, "");
  const numberOk = /^ET-?\d{5,9}$/.test(orderNumber);
  const normalizedNumber = numberOk ? orderNumber.replace(/^ET-?/, "ET-") : "";

  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`track:ip:${ip}`, 20, 900], [`track:user:${user.id}`, 10, 900]]))) return { error: "rate_limited", submitted, values };
  if (!numberOk) return { error: "order_not_found", submitted, values };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `order_number, status, payment_status, fulfillment_method, total_etb, created_at,
       items:order_items ( name_en, name_am, quantity ), history:order_status_history ( to_status, created_at )`,
    )
    .eq("order_number", normalizedNumber)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[track] lookup failed:", error.message);
    return { error: "unexpected", submitted, values };
  }
  if (!data) return { error: "order_not_found", submitted, values };
  const result = data as unknown as TrackedOrder;
  result.items ??= [];
  result.history = (result.history ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { result, submitted, values };
}
