"use server";
import { getCustomerUser } from "@/lib/account/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StockAlertState {
  signedIn: boolean;
  requested: boolean;
}

/** Is the visitor signed in, and did they already ask to be told about this product? */
export async function getStockAlertState(productId: string): Promise<StockAlertState> {
  if (!UUID.test(productId)) return { signedIn: false, requested: false };
  const user = await getCustomerUser();
  if (!user) return { signedIn: false, requested: false };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("stock_alerts").select("id").eq("product_id", productId).eq("user_id", user.id).is("notified_at", null).maybeSingle();
  return { signedIn: true, requested: !!data };
}

/** Turn "notify me when available" on or off. The database checks the product is really out of stock. */
export async function setStockAlert(productId: string, on: boolean): Promise<{ ok: boolean; requested: boolean; error?: string }> {
  if (!UUID.test(productId)) return { ok: false, requested: false, error: "invalid_request" };
  const user = await getCustomerUser();
  if (!user) return { ok: false, requested: false, error: "login_required" };
  if (!(await rateLimit(`stock-alert:${user.id}`, 30, 3600))) return { ok: false, requested: !on, error: "rate_limited" };
  const supabase = await createSupabaseServerClient();
  const { error } = on
    ? await supabase.rpc("request_stock_alert", { p_product_id: productId })
    : await supabase.rpc("cancel_stock_alert", { p_product_id: productId });
  if (error) return { ok: false, requested: !on, error: error.message };
  return { ok: true, requested: on };
}
