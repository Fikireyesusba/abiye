"use server";
import { z } from "zod";
import { getCustomerUser } from "@/lib/account/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Same allow-list as the database: only real browser push services. */
const PUSH_ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|[a-z0-9-]+\.push\.apple\.com)\//;

const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).regex(PUSH_ENDPOINT),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/) }),
});

export type PushResult = { ok: true } | { ok: false; error: "login_required" | "invalid" | "rate_limited" | "failed" };

/** Saves this device for the signed-in customer (called after the browser granted permission). */
export async function savePushSubscription(input: unknown, locale: unknown): Promise<PushResult> {
  const user = await getCustomerUser();
  if (!user) return { ok: false, error: "login_required" };
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!(await rateLimit(`push:save:${user.id}`, 20, 3600))) return { ok: false, error: "rate_limited" };
  const supabase = await createSupabaseServerClient();
  const { endpoint, keys } = parsed.data;
  // Re-subscribing the same device (or a device that changed account) replaces the old row.
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({
    endpoint, p256dh: keys.p256dh, auth: keys.auth, locale: locale === "am" ? "am" : "en",
  });
  if (error) {
    console.warn(`[push] save failed: ${error.code}`);
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}

export async function removePushSubscription(endpoint: unknown): Promise<PushResult> {
  const user = await getCustomerUser();
  if (!user) return { ok: false, error: "login_required" };
  if (typeof endpoint !== "string" || endpoint.length > 1000) return { ok: false, error: "invalid" };
  const supabase = await createSupabaseServerClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}

/** Does this device (endpoint) belong to the signed-in customer's notification list? */
export async function isPushSubscribed(endpoint: unknown): Promise<boolean> {
  const user = await getCustomerUser();
  if (!user || typeof endpoint !== "string") return false;
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("endpoint", endpoint);
  return (count ?? 0) > 0;
}
