import "server-only";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/security/tokens";

/**
 * Customer access to a guest order. Possession of the 256-bit access token is
 * the ONLY thing that grants access; the order id / number alone never does.
 * The browser that placed the order keeps it in an httpOnly cookie; the
 * customer can also open the private link (?t=token) on another device.
 */
const COOKIE_PREFIX = "ord_";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ORDER_COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

export function isGuid(v: unknown): v is string {
  return typeof v === "string" && GUID_RE.test(v);
}

export function isAccessToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_RE.test(v);
}

export async function rememberOrderAccess(orderId: string, accessToken: string, trackingCode: string) {
  (await cookies()).set(`${COOKIE_PREFIX}${orderId}`, `${accessToken}.${trackingCode}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ORDER_COOKIE_MAX_AGE,
  });
}

/** Token (and tracking code, if this browser placed the order) from the cookie. */
export async function readOrderAccess(orderId: string): Promise<{ token: string; trackingCode: string | null } | null> {
  const raw = (await cookies()).get(`${COOKIE_PREFIX}${orderId}`)?.value;
  if (!raw) return null;
  const [token, trackingCode] = raw.split(".");
  return isAccessToken(token) ? { token, trackingCode: trackingCode ?? null } : null;
}

export interface CustomerOrder {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_phone: string;
  fulfillment_method: "delivery" | "pickup";
  city: string | null;
  address_line: string | null;
  delivery_instructions: string | null;
  subtotal_etb: number;
  delivery_fee_etb: number;
  discount_etb: number;
  payment_method?: string;
  total_etb: number;
  bank_snapshot: {
    bank_name: string;
    account_holder: string;
    account_number: string;
    branch: string | null;
    instructions_en: string;
    instructions_am: string;
  };
  payment_due_at: string;
  created_at: string;
  items: { id: string; name_en: string; name_am: string; quantity: number; unit_price_etb: number; line_total_etb: number; product: { slug: string } | null }[];
  submissions: { status: string; review_note: string | null; submitted_at: string; transaction_reference: string | null }[];
  history: { to_status: string; created_at: string }[];
}

const ORDER_FIELDS = `id, order_number, status, payment_status, customer_name, customer_phone, fulfillment_method, city, address_line,
       delivery_instructions, subtotal_etb, delivery_fee_etb, discount_etb, total_etb, payment_method, bank_snapshot, payment_due_at, created_at,
       items:order_items ( id, name_en, name_am, quantity, unit_price_etb, line_total_etb, product:products ( slug ) ),
       submissions:payment_submissions ( status, review_note, submitted_at, transaction_reference ),
       history:order_status_history ( to_status, created_at )`;

/**
 * Authorize customer access to an order: by private-link token, OR because the
 * signed-in user placed it. Returns the order plus its stored token hash (used
 * server-side for submit_payment) — never send the hash to the browser.
 */
export async function authorizeCustomerOrder(
  orderId: string,
  opts: { token?: string | null; userId?: string | null },
): Promise<{ order: CustomerOrder; accessTokenHash: string } | null> {
  if (!isGuid(orderId)) return null;
  let q = getSupabaseAdmin().from("orders").select(`${ORDER_FIELDS}, access_token_hash, user_id`).eq("id", orderId);
  if (opts.token && isAccessToken(opts.token)) q = q.eq("access_token_hash", sha256Hex(opts.token));
  else if (opts.userId && isGuid(opts.userId)) q = q.eq("user_id", opts.userId);
  else return null;
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  const { access_token_hash, user_id: _u, ...rest } = data as unknown as CustomerOrder & { access_token_hash: string; user_id: string };
  void _u;
  const order = rest as CustomerOrder;
  order.submissions.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  order.history.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { order, accessTokenHash: access_token_hash };
}

/** Load an order for its customer. Returns null for a wrong id OR token (indistinguishable). */
export async function getOrderForCustomer(orderId: string, accessToken: string): Promise<CustomerOrder | null> {
  if (!isGuid(orderId) || !isAccessToken(accessToken)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select(
      `id, order_number, status, payment_status, customer_name, customer_phone, fulfillment_method, city, address_line,
       delivery_instructions, subtotal_etb, delivery_fee_etb, discount_etb, total_etb, payment_method, bank_snapshot, payment_due_at, created_at,
       items:order_items ( id, name_en, name_am, quantity, unit_price_etb, line_total_etb, product:products ( slug ) ),
       submissions:payment_submissions ( status, review_note, submitted_at, transaction_reference ),
       history:order_status_history ( to_status, created_at )`,
    )
    .eq("id", orderId)
    .eq("access_token_hash", sha256Hex(accessToken))
    .maybeSingle();
  if (error) {
    console.error("[order] load failed:", error.message);
    return null;
  }
  if (!data) return null;
  const order = data as unknown as CustomerOrder;
  order.submissions.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  order.history.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return order;
}
