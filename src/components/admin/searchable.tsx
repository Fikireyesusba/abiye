"use client";
import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Search box for a long list: hides rows (table rows or list items marked data-row) whose text does
 * not contain what is typed. Works on lists rendered by the server; nothing is reloaded.
 */
export function Searchable({ children, placeholder = "Search this list…", className }: { children: React.ReactNode; placeholder?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState<{ shown: number; total: number } | null>(null);
  const filter = (q: string) => {
    const rows = Array.from(box.current?.querySelectorAll<HTMLElement>("tbody > tr, [data-row]") ?? []).filter((r) => !r.querySelector("td[colspan]"));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const r of rows) {
      const hit = words.every((w) => (r.textContent ?? "").toLowerCase().includes(w));
      r.style.display = hit ? "" : "none";
      if (hit) shown++;
    }
    setCounts(words.length ? { shown, total: rows.length } : null);
  };
  return (
    <div className={cn("space-y-2", className)}>
      <label className="relative block max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input type="search" placeholder={placeholder} aria-label={placeholder} onChange={(e) => filter(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      </label>
      {counts && <p className="text-xs text-muted-foreground" aria-live="polite">{counts.shown} of {counts.total} shown</p>}
      <div ref={box}>{children}</div>
    </div>
  );
}
