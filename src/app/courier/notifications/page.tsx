import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MarkRead } from "./mark-read";

export const metadata: Metadata = { title: "Notifications" };

/** New deliveries, deliveries taken back and payments — newest first; opening the page marks them read. */
export default async function CourierNotificationsPage() {
  const ctx = await requirePermission("deliveries.own");
  const { data } = await (await createSupabaseServerClient()).from("courier_notifications")
    .select("id, kind, title, body, order_id, created_at, read_at").eq("courier_id", ctx.userId).order("id", { ascending: false }).limit(50);
  const rows = data ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Notifications</h1>
      {rows.some((r) => !r.read_at) && <MarkRead />}
      {rows.length === 0 ? <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">No notifications yet.</p> : (
        <ul className="divide-y rounded-xl border bg-card" data-testid="courier-notifications">
          {rows.map((n) => (
            <li key={n.id} className={`flex gap-3 px-4 py-3 ${n.read_at ? "" : "bg-primary/5"}`}>
              <Bell className={`mt-0.5 size-4 shrink-0 ${n.read_at ? "text-muted-foreground" : "text-primary"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={n.read_at ? "" : "font-medium"}>{n.title}</p>
                {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at, "en")}</p>
              </div>
              {(n.kind === "assigned" || n.kind === "available" || n.kind === "cancelled") && <Link href="/courier" className="self-center text-sm text-primary underline">Open</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
