import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Expires unpaid orders past their payment window and releases reserved stock. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin().rpc("expire_unpaid_orders");
  if (error) {
    console.error("[cron] expire_unpaid_orders failed:", error.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ expired: data });
}
