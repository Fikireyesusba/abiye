import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";

export type PublicBucket = "product-images" | "site-assets";

/** Public URL for an object in a PUBLIC bucket. Private buckets never go through here. */
export function publicImageUrl(bucket: PublicBucket, path: string | null | undefined): string | null {
  if (!path) return null;
  const { url } = getPublicSupabaseEnv();
  const safe = path.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/public/${bucket}/${safe}`;
}
