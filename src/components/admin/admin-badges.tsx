"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { refreshAdminBadges } from "@/lib/admin/badge-actions";
import type { AdminBadges } from "@/lib/admin/badges";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;
const BadgesContext = createContext<AdminBadges>({});

/**
 * Holds the "waiting for action" counts for the admin menu. Starts from the
 * server-rendered values, then refreshes every minute while the tab is
 * visible and whenever the admin comes back to the tab.
 */
export function AdminBadgesProvider({ initial, children }: { initial: AdminBadges; children: React.ReactNode }) {
  const [badges, setBadges] = useState(initial);
  // A server action that revalidates the page (e.g. "Verify payment") re-renders
  // the layout with fresh counts: adopt them immediately.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setBadges(initial);
  }
  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      refreshAdminBadges()
        .then((b) => { if (b && !stopped) setBadges(b); })
        .catch(() => {});
    };
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return <BadgesContext.Provider value={badges}>{children}</BadgesContext.Provider>;
}

export const useAdminBadges = () => useContext(BadgesContext);
export const badgeTotal = (b: AdminBadges) => Object.values(b).reduce((s: number, n) => s + (n ?? 0), 0);

/** Red count bubble. */
export function CountBadge({ count, label, className }: { count: number; label: string; className?: string }) {
  if (!count) return null;
  return (
    <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs leading-5 font-semibold text-white tabular-nums", className)}
      aria-label={label} title={label}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Header shortcut: red "N payments to verify". */
export function PendingPaymentsLink() {
  const n = useAdminBadges()["/admin/payments"] ?? 0;
  if (!n) return null;
  return (
    <Link href="/admin/payments?status=pending" className="hidden items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 sm:inline-flex">
      {n} payment{n === 1 ? "" : "s"} to verify
    </Link>
  );
}
