import "server-only";
import type { AdminContext } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isCustomerAlert, isEmailAlert } from "./security-alerts";

/** Things waiting for an admin's action, per menu entry (only what this role may see; RLS applies). */
export type AdminBadges = Partial<Record<"/admin/payments" | "/admin/wallet" | "/admin/orders" | "/admin/printing" | "/admin/notifications" | "/admin/security" | "/admin/inventory" | "/admin/reviews", number>>;

export async function getAdminBadges(ctx: AdminContext): Promise<AdminBadges> {
  const supabase = await createSupabaseServerClient();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const has = (p: Parameters<AdminContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const [payments, wallet, orders, printing, notifications, security, lowStock, reviews] = await Promise.all([
    // Receipts waiting to be checked against the bank account.
    has("payments.view") ? count(supabase.from("payment_submissions").select("id", { count: "exact", head: true }).eq("status", "pending")) : 0,
    // Wallet top-ups waiting to be checked against the bank account.
    has("wallet.manage") ? count(supabase.from("wallet_topups").select("id", { count: "exact", head: true }).eq("status", "pending")) : 0,
    // Paid orders waiting to be processed (staff: only orders assigned to them, via RLS).
    has("orders.view_all") || has("orders.view_assigned")
      ? count(supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "confirmed")) : 0,
    // Printing jobs waiting for a price quote, or paid and waiting to be printed.
    has("printing.view") ? count(supabase.from("printing_jobs").select("id", { count: "exact", head: true }).in("status", ["awaiting_quote", "printing"])) : 0,
    // Telegram notifications that failed permanently (among the most recent 200).
    has("settings.manage")
      ? Promise.resolve(supabase.rpc("admin_notifications", { p_limit: 200 })).then((r) => (r.data ?? []).filter((n) => n.status === "dead" && !n.last_error?.startsWith("skipped")).length, () => 0)
      : 0,
    // High-risk emails (failed admin sign-ins / codes) from the last 24 h that are not blocked yet.
    // Active security alerts (same as Security → Active alerts): high-risk emails + suspicious customers not yet reviewed / blocked.
    has("audit.view")
      ? Promise.all([
          Promise.resolve(supabase.rpc("admin_suspicious_emails", { p_days: 7 })).then((r) => (r.data ?? []).filter(isEmailAlert).length, () => 0),
          Promise.resolve(supabase.rpc("admin_suspicious_customers", { p_days: 30 })).then((r) => (r.data ?? []).filter(isCustomerAlert).length, () => 0),
        ]).then(([a, b]) => a + b)
      : 0,
    // Active products at or below their low-stock level (incl. sold out).
    has("inventory.manage") ? Promise.resolve(supabase.rpc("admin_low_stock_count")).then((r) => Number(r.data ?? 0), () => 0) : 0,
    // Product reviews waiting for approval.
    has("reviews.manage") ? Promise.resolve(supabase.rpc("admin_product_reviews", { p_status: "pending", p_limit: 500 })).then((r) => (r.data ?? []).length, () => 0) : 0,
  ]);
  return { "/admin/payments": payments, "/admin/wallet": wallet, "/admin/orders": orders, "/admin/printing": printing, "/admin/notifications": notifications, "/admin/security": security, "/admin/inventory": lowStock, "/admin/reviews": reviews };
}
