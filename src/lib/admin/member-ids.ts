import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** User IDs (6 digits) of the given accounts. Call only after the page's permission check. */
export async function memberIds(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  // Small batches: the ids travel in the request URL.
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await getSupabaseAdmin().from("customer_accounts").select("id, member_id").in("id", ids.slice(i, i + 80));
    if (error) console.error("[member-ids] lookup failed:", error.code);
    for (const r of data ?? []) map.set(r.id, r.member_id);
  }
  return map;
}
