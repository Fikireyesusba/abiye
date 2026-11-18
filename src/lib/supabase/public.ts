import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getPublicSupabaseEnv } from "./public-env";

let client: SupabaseClient<Database> | undefined;

/**
 * Anonymous, cookie-less client for PUBLIC storefront reads. It runs with the
 * `anon` role, so RLS + column grants limit it to active catalog data.
 */
export function getSupabasePublic(): SupabaseClient<Database> {
  if (client) return client;
  const { url, publishableKey } = getPublicSupabaseEnv();
  client = createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
