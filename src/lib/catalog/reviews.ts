import "server-only";
import { cache } from "react";
import { getSupabasePublic } from "@/lib/supabase/public";

export interface Rating {
  avg: number;
  count: number;
}

export interface PublicReview {
  id: string;
  rating: number;
  body: string | null;
  display_name: string;
  created_at: string;
}

/**
 * Approved-review averages for a set of products. Read separately from the product queries and
 * tolerant of errors, so the shop keeps working if the reviews database update is not applied yet.
 */
export async function getRatings(productIds: string[]): Promise<Map<string, Rating>> {
  const out = new Map<string, Rating>();
  if (!productIds.length) return out;
  const { data, error } = await getSupabasePublic().from("products").select("id, rating_avg, rating_count").in("id", productIds).gt("rating_count", 0);
  if (error) return out;
  for (const r of data ?? []) if (r.rating_avg !== null) out.set(r.id, { avg: Number(r.rating_avg), count: r.rating_count });
  return out;
}

/** Newest approved reviews of a product (public fields only). */
export const getProductReviews = cache(async (productId: string, limit = 20): Promise<PublicReview[]> => {
  const { data, error } = await getSupabasePublic()
    .from("product_reviews").select("id, rating, body, display_name, created_at")
    .eq("product_id", productId).order("created_at", { ascending: false }).limit(limit);
  return error ? [] : (data ?? []);
});
