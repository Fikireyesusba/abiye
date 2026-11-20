import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The signed-in customer's wallet (RLS: own rows only). */
export async function getMyWallet(userId: string) {
  const supabase = await createSupabaseServerClient();
  const [{ data: acc }, { data: topups }, { data: ledger }] = await Promise.all([
    supabase.from("customer_accounts").select("wallet_balance_etb").eq("id", userId).maybeSingle(),
    supabase.from("wallet_topups").select("id, topup_number, amount_etb, status, review_note, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("wallet_ledger").select("id, amount_etb, balance_after_etb, kind, note, created_at").order("id", { ascending: false }).limit(50),
  ]);
  const pending = (topups ?? []).filter((t) => t.status === "pending").reduce((s, t) => s + Number(t.amount_etb), 0);
  return { balance: Number(acc?.wallet_balance_etb ?? 0), pending, topups: topups ?? [], ledger: ledger ?? [] };
}
