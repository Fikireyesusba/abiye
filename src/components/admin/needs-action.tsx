"use client";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { BADGE_LABEL } from "./admin-nav";
import { useAdminBadges } from "./admin-badges";

/** Dashboard: one yellow box listing every section that needs an action now (same counts as the menu). */
export function NeedsAction() {
  const badges = useAdminBadges();
  const items = Object.entries(badges).filter(([, n]) => (n ?? 0) > 0);
  if (items.length === 0) return null;
  return (
    <section className="mb-6 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-black dark:bg-amber-400/10 dark:text-foreground" data-testid="needs-action">
      <h2 className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="size-5 text-amber-600" aria-hidden /> Needs your action</h2>
      <ul className="grid gap-1 sm:grid-cols-2">
        {items.map(([href, n]) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-amber-100 dark:hover:bg-amber-400/20">
              <span className="inline-flex min-w-6 justify-center rounded-full bg-amber-400 px-1.5 text-xs font-semibold leading-5 text-black tabular-nums">{n}</span>
              {BADGE_LABEL[href] ?? href}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
