"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "./public-env";

/** Browser client (publishable key only). Used for admin sign-in. */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
