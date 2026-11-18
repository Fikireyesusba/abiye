import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { Database } from "./database.types";

let client: SupabaseClient<Database> | undefined;

/**
 * PRIVILEGED client using the Supabase secret (service role) key. It bypasses
 * RLS, so it may only be used by server code that has ALREADY validated input,
 * applied rate limits and checked authorization — e.g. guest checkout, receipt
 * upload, the notification worker. Never pass its results to the browser
 * without selecting the exact fields required.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (client) return client;
  const env = getServerEnv();
  client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
