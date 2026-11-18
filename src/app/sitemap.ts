import type { MetadataRoute } from "next";
import { getSupabasePublic } from "@/lib/supabase/public";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const statics = ["", "/shop", "/cosmetics", "/electronics", "/printing", "/about", "/contact", "/privacy", "/terms"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: "daily" as const,
  }));
  try {
    const { data } = await getSupabasePublic().from("products").select("slug, updated_at").eq("status", "active").limit(5000);
    return [...statics, ...(data ?? []).map((p) => ({ url: `${base}/products/${p.slug}`, lastModified: p.updated_at }))];
  } catch {
    return statics;
  }
}
