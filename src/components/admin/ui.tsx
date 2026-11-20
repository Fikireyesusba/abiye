import Link from "next/link";
import { cn } from "@/lib/utils";
import { Searchable } from "./searchable";

/** Small presentational building blocks shared by admin pages. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className, actions }: { title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-xs", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** `scroll`: long lists stay in a box of fixed height that scrolls on its own, with the column titles kept visible. */
export function Table({ head, children, empty, scroll, search = true }: { head: React.ReactNode[]; children: React.ReactNode; empty?: string; scroll?: boolean; search?: boolean }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  const table = (
    // Focusable so keyboard users can scroll wide tables on small screens.
    <div className={cn("overflow-x-auto rounded-xl border bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", scroll && "max-h-[65vh] overflow-y-auto overscroll-contain")} tabIndex={0}>
      <table className="w-full min-w-[640px] text-sm">
        <thead className={cn("text-left text-xs tracking-wide text-muted-foreground uppercase", scroll ? "sticky top-0 z-10 bg-muted shadow-[0_1px_0_var(--border)]" : "bg-muted/60")}>
          <tr>{head.map((h, i) => <th key={i} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.length ? children : (
            <tr><td colSpan={head.length} className="px-4 py-10 text-center text-muted-foreground">{empty ?? "Nothing here yet."}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
  // Long lists: a search box above the scrolling box (only when there is something to search).
  return scroll && search && rows.length > 5 ? <Searchable>{table}</Searchable> : table;
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-top", className)}>{children}</td>;
}

export function StatCard({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "warning" | "danger" }) {
  const body = (
    <div className={cn("rounded-xl border bg-card p-4 shadow-xs transition-shadow", href && "hover:shadow-md",
      tone === "warning" && "border-warning/50", tone === "danger" && "border-destructive/40")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export const fieldClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Labelled form control. With `htmlFor` the label points at that id; without
 * it, the label wraps the control, so every input still has an accessible name.
 */
export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {htmlFor ? (
        <>
          <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
          {children}
        </>
      ) : (
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{label}</span>
          {children}
        </label>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** PostgREST "function not found": the page's database migration has not been applied yet. */
export const isMissingDbFunction = (error: { code?: string } | null) => error?.code === "PGRST202" || error?.code === "42883";

export function DatabaseUpdateNeeded({ title, migration }: { title: string; migration: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div role="alert" className="max-w-2xl space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
        <p className="font-semibold">Database update needed</p>
        <p>
          This page needs a database update that has not been applied yet. In Supabase → SQL Editor, run the file{" "}
          <code className="rounded bg-muted px-1 py-0.5 break-all">supabase/migrations/{migration}</code> (copy it from GitHub → Raw), then reload this page.
        </p>
      </div>
    </>
  );
}
