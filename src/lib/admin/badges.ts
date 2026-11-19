import "server-only";
import type { AdminContext } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Things waiting for an admin's action, per menu entry (only what this role may see; RLS applies). */
export type AdminBadges = Partial<Record<"/admin/payments" | "/admin/orders" | "/admin/printing" | "/admin/notifications", number>>;

export async function getAdminBadges(ctx: AdminContext): Promise<AdminBadges> {
  const supabase = await createSupabaseServerClient();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const has = (p: Parameters<AdminContext["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const [payments, orders, printing, notifications] = await Promise.all([
    // Receipts waiting to be checked against the bank account.
    has("payments.view") ? count(supabase.from("payment_submissions").select("id", { count: "exact", head: true }).eq("status", "pending")) : 0,
    // Paid orders waiting to be processed (staff: only orders assigned to them, via RLS).
    has("orders.view_all") || has("orders.view_assigned")
      ? count(supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "confirmed")) : 0,
    // Printing jobs waiting for a price quote, or paid and waiting to be printed.
    has("printing.view") ? count(supabase.from("printing_jobs").select("id", { count: "exact", head: true }).in("status", ["awaiting_quote", "printing"])) : 0,
    // Telegram notifications that failed permanently (among the most recent 200).
    has("settings.manage")
      ? Promise.resolve(supabase.rpc("admin_notifications", { p_limit: 200 })).then((r) => (r.data ?? []).filter((n) => n.status === "dead").length, () => 0)
      : 0,
  ]);
  return { "/admin/payments": payments, "/admin/orders": orders, "/admin/printing": printing, "/admin/notifications": notifications };
}
