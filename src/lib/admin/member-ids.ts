import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** User IDs (6 digits) of the given accounts. Call only after the page's permission check. */
export async function memberIds(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const { data } = await getSupabaseAdmin().from("customer_accounts").select("id, member_id").in("id", ids.slice(0, 1000));
  return new Map((data ?? []).map((r) => [r.id, r.member_id]));
}
