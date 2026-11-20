"use server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_COOKIE, SESSION_COOKIE } from "./idle";

/** Sign out after inactivity (called by the browser timer). */
export async function idleSignOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const jar = await cookies();
  jar.delete(ACTIVE_COOKIE);
  jar.delete(SESSION_COOKIE);
}
