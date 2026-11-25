"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
  const last = useRef(initial);
  useEffect(() => {
    last.current = badges;
  }, [badges]);
  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      refreshAdminBadges()
        .then((b) => {
          if (!b || stopped) return;
          // Yellow pop-up for sections that got NEW items since the last check.
          for (const [href, n] of Object.entries(b)) {
            const before = last.current[href as keyof AdminBadges] ?? 0;
            if ((n ?? 0) > before) announce(href, (n ?? 0) - before);
          }
          last.current = b;
          setBadges(b);
        })
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

const NEW_LABEL: Record<string, string> = {
  "/admin/payments": "payment(s) to verify", "/admin/wallet": "top-up(s) to verify", "/admin/orders": "paid order(s) to process",
  "/admin/printing": "printing job(s) to quote or print", "/admin/notifications": "failed notification(s)", "/admin/security": "security alert(s)",
  "/admin/inventory": "product(s) low on stock", "/admin/reviews": "review(s) to approve", "/admin/support": "support ticket(s)",
  "/admin/approvals": "account(s) to approve", "/admin/couriers": "paid order(s) without a courier", "/admin/delivery-monitor": "late / locked deliveries",
  "/admin/documents": "document(s) expiring", "/admin/partners": "shop staff to link",
};
function announce(href: string, added: number) {
  toast(`${added} new ${NEW_LABEL[href] ?? "item(s) waiting"}`, {
    className: "!border-amber-400 !bg-amber-50 !text-black",
    action: { label: "Open", onClick: () => { window.location.href = href; } },
    duration: 10000,
  });
}
export const badgeTotal = (b: AdminBadges) => Object.values(b).reduce((s: number, n) => s + (n ?? 0), 0);

/** Count bubble: yellow = action needed (red only for security alerts). */
export function CountBadge({ count, label, className, tone = "yellow" }: { count: number; label: string; className?: string; tone?: "yellow" | "red" }) {
  if (!count) return null;
  return (
    <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5 font-semibold tabular-nums",
      tone === "red" ? "bg-red-600 text-white" : "bg-amber-400 text-black", className)} data-badge-tone={tone}
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
    <Link href="/admin/payments?status=pending" className="hidden items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-black hover:bg-amber-300 sm:inline-flex">
      {n} payment{n === 1 ? "" : "s"} to verify
    </Link>
  );
}
