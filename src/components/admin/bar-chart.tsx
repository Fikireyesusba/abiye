"use client";
import { useState } from "react";

export interface BarDatum {
  label: string; // x-axis label (short)
  full: string; // tooltip/table label
  value: number;
  display: string; // formatted value
}

/**
 * Single-series bar chart. Bars use the validated --chart-1 token; 4px rounded
 * data-end, anchored to the baseline, 2px gaps; per-bar hover/focus tooltip;
 * a visually hidden table carries the same data for screen readers.
 */
export function BarChart({ data, title, height = 180 }: { data: BarDatum[]; title: string; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = [0, 0.5, 1].map((f) => ({ f, v: Math.round(max * f * 10) / 10 }));
  const n = data.length;
  if (data.every((d) => d.value === 0)) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" style={{ height }}>
        No data in this period yet.
      </div>
    );
  }

  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="relative" style={{ height }} onMouseLeave={() => setActive(null)}>
        {/* recessive grid */}
        {ticks.map((t) => (
          <div key={t.f} className="absolute right-0 left-0 border-t border-dashed border-border" style={{ bottom: `${t.f * 100}%` }}>
            <span className="absolute -top-2.5 left-0 bg-card pr-1 text-[10px] text-muted-foreground tabular-nums">{t.f ? t.v.toLocaleString("en-US") : ""}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px] pl-10" aria-hidden>
          {data.map((d, i) => (
            <button
              key={d.full}
              type="button"
              tabIndex={0}
              className="group relative flex h-full flex-1 items-end focus-visible:outline-none"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${d.full}: ${d.display}`}
            >
              <span
                className="block w-full rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-85 group-focus-visible:ring-2 group-focus-visible:ring-ring"
                style={{ height: d.value > 0 ? `max(2px, ${(d.value / max) * 100}%)` : 0 }}
              />
            </button>
          ))}
        </div>
        {active !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `calc(2.5rem + (100% - 2.5rem) * ${(active + 0.5) / n})`, bottom: `calc(${(data[active].value / max) * 100}% + 8px)` }}
            role="status"
          >
            <p className="text-muted-foreground">{data[active].full}</p>
            <p className="font-semibold tabular-nums">{data[active].display}</p>
          </div>
        )}
      </div>
      <div className="flex gap-[2px] pl-10 text-[10px] text-muted-foreground" aria-hidden>
        {data.map((d, i) => (
          <span key={d.full} className="flex-1 truncate text-center">{i % 2 === n % 2 || n <= 8 ? d.label : ""}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>{data.map((d) => <tr key={d.full}><th scope="row">{d.full}</th><td>{d.display}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
