"use server";
import { toAppError, type AppErrorCode } from "@/lib/errors";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { generateAccessToken, generateTrackingCode, sha256Hex } from "@/lib/security/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkoutSchema } from "@/lib/validation/checkout";
import { rememberOrderAccess } from "./access";

export type PlaceOrderResult =
  | { ok: true; orderId: string; orderNumber: string }
  | { ok: false; error: AppErrorCode; detail?: string; fieldErrors?: Partial<Record<CheckoutField, AppErrorCode>> };

type CheckoutField = "fullName" | "phone" | "deliveryZoneId" | "addressLine" | "instructions" | "items";

const FIELD_ERROR: Record<CheckoutField, AppErrorCode> = {
  fullName: "invalid_name",
  phone: "invalid_phone",
  deliveryZoneId: "invalid_delivery_zone",
  addressLine: "invalid_address",
  instructions: "invalid_instructions",
  items: "invalid_cart",
};

/**
 * Guest checkout. Validates, rate-limits, then calls public.create_order(),
 * which recomputes every price, fee and stock level in one transaction.
 * Nothing price-related is accepted from the browser.
 */
export async function placeOrder(input: unknown): Promise<PlaceOrderResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<CheckoutField, AppErrorCode>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as CheckoutField;
      if (field in FIELD_ERROR && !fieldErrors[field]) fieldErrors[field] = FIELD_ERROR[field];
    }
    return { ok: false, error: Object.keys(fieldErrors).length ? Object.values(fieldErrors)[0]! : "invalid_request", fieldErrors };
  }
  const v = parsed.data;

  const ip = await clientIpKey();
  const allowed = await rateLimitAll([
    [`checkout:ip:${ip}`, 10, 600],
    [`checkout:phone:${sha256Hex(v.phone).slice(0, 32)}`, 5, 600],
  ]);
  if (!allowed) return { ok: false, error: "rate_limited" };

  const db = getSupabaseAdmin();
  // Opportunistically release stock held by overdue unpaid orders (cheap, SKIP LOCKED).
  await db.rpc("expire_unpaid_orders");

  const accessToken = generateAccessToken();
  const trackingCode = generateTrackingCode();

  const { data, error } = await db.rpc("create_order", {
    p_input: {
      idempotency_key: v.idempotencyKey,
      access_token_hash: sha256Hex(accessToken),
      tracking_code_hash: sha256Hex(trackingCode),
      locale: v.locale,
      customer: { full_name: v.fullName, phone: v.phone },
      fulfillment: {
        method: v.fulfillment,
        delivery_zone_id: v.fulfillment === "delivery" ? v.deliveryZoneId : null,
        address_line: v.fulfillment === "delivery" ? v.addressLine : null,
        instructions: v.instructions || null,
      },
      items: v.items.map((i) =>
        i.type === "product"
          ? { type: "product", product_id: i.productId, quantity: i.quantity }
          : { type: "printing", printing_job_id: i.printingJobId, access_token_hash: sha256Hex(i.accessToken) },
      ),
    },
  });

  if (error) {
    const appError = toAppError(error);
    if (appError.code === "unexpected") console.error("[checkout] create_order failed:", error.code, error.message);
    return { ok: false, error: appError.code, detail: appError.detail };
  }

  const result = data as { order_id: string; order_number: string };
  // On an idempotent replay the DB rotated the hashes to these new tokens, so they are valid either way.
  await rememberOrderAccess(result.order_id, accessToken, trackingCode);
  return { ok: true, orderId: result.order_id, orderNumber: result.order_number };
}
