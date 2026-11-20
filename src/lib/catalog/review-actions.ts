"use server";
import { getCustomerUser } from "@/lib/account/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MyReview {
  signedIn: boolean;
  eligible: boolean;
  review: { rating: number; body: string | null; status: "pending" | "approved" | "rejected"; note: string | null } | null;
}

/** Can the signed-in customer review this product (received it), and what did they write? */
export async function getMyReview(productId: string): Promise<MyReview> {
  const none: MyReview = { signedIn: false, eligible: false, review: null };
  if (!UUID.test(productId)) return none;
  const user = await getCustomerUser();
  if (!user) return none;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_product_review", { p_product_id: productId });
  if (error || !data) return { ...none, signedIn: true };
  const d = data as { eligible?: boolean; review?: MyReview["review"] };
  return { signedIn: true, eligible: !!d.eligible, review: d.review ?? null };
}

export async function saveReview(productId: string, rating: number, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(productId) || !Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "invalid" };
  const text = body.replace(/\r\n/g, "\n").trim();
  if (text.length > 1000) return { ok: false, error: "tooLong" };
  const user = await getCustomerUser();
  if (!user) return { ok: false, error: "login" };
  if (!(await rateLimit(`review:${user.id}`, 20, 3600))) return { ok: false, error: "rateLimited" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_product_review", { p_product_id: productId, p_rating: rating, p_body: text || undefined });
  return error ? { ok: false, error: error.message === "forbidden" ? "notEligible" : "failed" } : { ok: true };
}

export async function deleteReview(productId: string): Promise<{ ok: boolean }> {
  if (!UUID.test(productId)) return { ok: false };
  const user = await getCustomerUser();
  if (!user) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_my_product_review", { p_product_id: productId });
  return { ok: !error };
}
