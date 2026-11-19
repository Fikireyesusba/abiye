import "server-only";
import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface PublicBankAccount {
  id: string;
  bank_name: string;
  account_holder: string;
  account_number: string;
  branch: string | null;
  instructions_en: string;
  instructions_am: string;
}

/**
 * Active bank accounts for the public "How to pay" section. These details are
 * shown to every customer at checkout anyway; the table itself stays closed to
 * anon (RLS) and we select only customer-facing columns here.
 */
export const getPublicBankAccounts = cache(async (): Promise<PublicBankAccount[]> => {
  const { data, error } = await getSupabaseAdmin()
    .from("bank_accounts")
    .select("id, bank_name, account_holder, account_number, branch, instructions_en, instructions_am")
    .eq("is_active", true)
    .order("sort_order");
  if (error) {
    console.error("[bank-info] load failed:", error.message);
    return [];
  }
  return data;
});
