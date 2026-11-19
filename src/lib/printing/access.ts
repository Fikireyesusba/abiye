import "server-only";
import { cookies } from "next/headers";
import { isAccessToken, isGuid } from "@/lib/orders/access";
import { sha256Hex } from "@/lib/security/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Printing-job access works like order access: 256-bit token, httpOnly cookie + private link. */
const PREFIX = "pj_";

export async function rememberJobAccess(jobId: string, token: string) {
  (await cookies()).set(`${PREFIX}${jobId}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
}

export async function readJobAccess(jobId: string): Promise<string | null> {
  const v = (await cookies()).get(`${PREFIX}${jobId}`)?.value;
  return isAccessToken(v) ? v : null;
}

export interface CustomerPrintJob {
  id: string;
  job_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  color_mode: "bw" | "color";
  paper_size: string;
  sides: "single" | "double";
  copies: number;
  page_count: number | null;
  price_per_page_etb: number | null;
  service_charge_etb: number;
  total_etb: number | null;
  fulfillment_method: "delivery" | "pickup";
  customer_notes: string | null;
  order_id: string | null;
  files_delete_after: string;
  created_at: string;
  files: { original_name: string; page_count: number | null; deleted_at: string | null }[];
  history: { to_status: string; created_at: string; note: string | null }[];
  order: { order_number: string; status: string } | null;
}

/** By private-link token, or because the signed-in user owns the job. */
export async function getJobForCustomer(jobId: string, token: string | null, userId?: string | null): Promise<CustomerPrintJob | null> {
  if (!isGuid(jobId)) return null;
  if (!(token && isAccessToken(token)) && !(userId && isGuid(userId))) return null;
  let q = getSupabaseAdmin()
    .from("printing_jobs")
    .select(
      `id, job_number, status, customer_name, customer_phone, color_mode, paper_size, sides, copies, page_count,
       price_per_page_etb, service_charge_etb, total_etb, fulfillment_method, customer_notes, order_id, files_delete_after, created_at,
       files:printing_files ( original_name, page_count, deleted_at ),
       history:printing_job_history ( to_status, created_at, note ),
       order:orders ( order_number, status )`,
    )
    .eq("id", jobId);
  q = token && isAccessToken(token) ? q.eq("access_token_hash", sha256Hex(token)) : q.eq("user_id", userId!);
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.error("[printing] job load failed:", error.message);
    return null;
  }
  if (!data) return null;
  const job = data as unknown as CustomerPrintJob;
  job.history.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return job;
}

/** Minimal job info for the basket: token-verified, or owned by the signed-in user. */
export async function getJobsForCart(items: { id: string; token?: string }[], userId?: string | null) {
  const valid = items.filter((i) => isGuid(i.id)).slice(0, 10);
  if (!valid.length) return [];
  const { data } = await getSupabaseAdmin()
    .from("printing_jobs")
    .select("id, job_number, status, total_etb, order_id, color_mode, paper_size, sides, copies, page_count, access_token_hash, user_id")
    .in("id", valid.map((i) => i.id));
  const hashes = new Map(valid.map((i) => [i.id, i.token && isAccessToken(i.token) ? sha256Hex(i.token) : null]));
  return (data ?? [])
    .filter((j) => hashes.get(j.id) === j.access_token_hash || (!!userId && j.user_id === userId))
    .map((j) => ({ ...j, access_token_hash: undefined, user_id: undefined }));
}
