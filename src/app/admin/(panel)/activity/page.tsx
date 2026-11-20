import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Table, Td, fieldClass, DatabaseUpdateNeeded, isMissingDbFunction } from "@/components/admin/ui";
import { Download, FileSpreadsheet, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Button } from "@/components/ui/button";
import { clearActivityLog } from "@/lib/admin/audit-actions";
import { ENTITY_LABELS, actionLabel, describeChanges, entityLabel } from "@/lib/admin/activity";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity log" };

const CATS = [
  { key: "orders", label: "Orders & printing", hint: "Status changes, assignments, quotes, file deletions" },
  { key: "payments", label: "Payments & wallet", hint: "Payments verified / rejected, top-ups, balance corrections" },
  { key: "customers", label: "Customers", hint: "Accounts deactivated / deleted, invitations, profile changes, promo codes" },
  { key: "catalog", label: "Products & catalog", hint: "Products, categories, promotions, delivery zones, printing prices, reviews" },
  { key: "staff", label: "Staff & settings", hint: "Staff, roles, two-step resets, bank accounts, website settings" },
  { key: "security", label: "Security & data", hint: "Blocked emails, cleared alerts, exports, activity clearing, resets" },
] as const;

const PAGE = 100;

function entityHref(type: string, id: string | null): string | null {
  if (!id) return null;
  switch (type) {
    case "order": return `/admin/orders/${id}`;
    case "printing_job": return `/admin/printing/${id}`;
    case "customer_account": return `/admin/customers/${id}`;
    case "products": return `/admin/products/${id}`;
    default: return null;
  }
}

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const ctx = await requirePermission("audit.view");
  const canClear = ctx.permissions.has("audit.manage");
  const now = new Date().getTime() + 3 * 3600 * 1000; // Addis Ababa
  const today = new Date(now).toISOString().slice(0, 10);
  const monthAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  const clearMax = new Date(now - 31 * 86400000).toISOString().slice(0, 10);
  const sp = await searchParams;
  const catParam = first(sp.cat) ?? "";
  const cat = CATS.find((c) => c.key === catParam)?.key ?? "";
  const q = (first(sp.q) ?? "").trim().slice(0, 60);
  const beforeRaw = Number(first(sp.before));
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;

  const supabase = await createSupabaseServerClient();
  const [{ data: rows, error }, { data: counts }] = await Promise.all([
    supabase.rpc("admin_activity_by_category", { p_category: cat || undefined, p_search: q || undefined, p_limit: PAGE, p_before_id: before }),
    supabase.rpc("admin_activity_categories", { p_days: 30 }),
  ]);
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Activity log" migration="20261120000038_activity_categories.sql" />;
  if (error) throw new Error("Could not load the activity log");
  const last = rows?.at(-1);
  const params = new URLSearchParams({ ...(cat ? { cat } : {}), ...(q ? { q } : {}) });
  const countOf = (k: string) => (counts ?? []).find((c) => c.category === k);
  const totalAll = (counts ?? []).reduce((n, c) => n + Number(c.total), 0);

  return (
    <>
      <PageHeader title="Activity log" description="Every important change: who did it and when. Entries cannot be edited; only a Super Admin can clear entries older than 30 days." />
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <details className="rounded-lg border bg-card p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><FileSpreadsheet className="size-4 text-primary" aria-hidden /> Export to Excel</summary>
          <form method="get" action="/admin/activity/export" className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">From<input type="date" name="from" required defaultValue={monthAgo} max={today} className={`${fieldClass} mt-1 block`} /></label>
            <label className="text-sm">To<input type="date" name="to" required defaultValue={today} max={today} className={`${fieldClass} mt-1 block`} /></label>
            <label className="text-sm">Area
              <select name="type" defaultValue="" className={`${fieldClass} mt-1 block w-auto`}>
                <option value="">All areas</option>
                {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <Button type="submit"><Download /> Download .xlsx</Button>
          </form>
        </details>
        {canClear && (
          <details className="rounded-lg border border-destructive/30 bg-card p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-destructive"><Trash2 className="size-4" aria-hidden /> Clear old entries</summary>
            <ActionForm action={clearActivityLog} submitLabel="Clear entries" variant="destructive" size="sm" className="mt-3"
              confirm="Permanently remove these activity entries? Make sure you downloaded the Excel export first.">
              <p className="text-xs text-muted-foreground">Removes entries created <strong>before</strong> the chosen date. The last 30 days are always kept, and every clearing is recorded permanently.</p>
              <label className="text-sm">Clear everything before
                <input type="date" name="before" required max={clearMax} defaultValue={clearMax} className={`${fieldClass} mt-1 block w-auto`} />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exported" required className="size-4 accent-[var(--primary)]" /> I downloaded an Excel export of these entries</label>
            </ActionForm>
          </details>
        )}
      </div>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Categories — last 30 days (click to open)</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <Link href={`/admin/activity${q ? `?q=${encodeURIComponent(q)}` : ""}`} aria-current={!cat ? "page" : undefined}
          className={`rounded-lg border bg-card p-3 text-sm hover:border-primary ${!cat ? "border-primary ring-1 ring-primary" : ""}`}>
          <span className="block font-medium">All activity</span>
          <span className="text-2xl font-semibold tabular-nums">{totalAll}</span>
        </Link>
        {CATS.map((c) => {
          const n = countOf(c.key);
          return (
            <Link key={c.key} href={`/admin/activity?${new URLSearchParams({ cat: c.key, ...(q ? { q } : {}) })}`} aria-current={cat === c.key ? "page" : undefined}
              title={c.hint} data-category={c.key}
              className={`rounded-lg border bg-card p-3 text-sm hover:border-primary ${cat === c.key ? "border-primary ring-1 ring-primary" : ""}`}>
              <span className="block font-medium">{c.label}</span>
              <span className="text-2xl font-semibold tabular-nums">{n ? Number(n.total) : 0}</span>
              {n?.last_at && <span className="block text-xs text-muted-foreground">latest {formatDateTime(n.last_at, "en")}</span>}
            </Link>
          );
        })}
      </div>
      {cat && <p className="mb-3 text-sm text-muted-foreground"><strong className="text-foreground">{CATS.find((c) => c.key === cat)?.label}:</strong> {CATS.find((c) => c.key === cat)?.hint}</p>}
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        {cat && <input type="hidden" name="cat" value={cat} />}
        <input name="q" defaultValue={q} placeholder="Action, ID or person" maxLength={60} className={`${fieldClass} max-w-xs`} aria-label="Search activity" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <Table scroll head={["When", "Who", "What", "Item", "Changes"]} empty="No activity found.">
        {(rows ?? []).map((r) => {
          const href = entityHref(r.entity_type, r.entity_type === "customer_account" && r.action === "customer_deleted" ? null : r.entity_id);
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          const changes = describeChanges(r.before_data, r.after_data);
          const notes = Object.entries(meta)
            .filter(([, v]) => typeof v === "string" || typeof v === "number")
            .map(([k, v]) => `${k}: ${String(v)}`);
          return (
            <tr key={r.id} className="align-top">
              <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at, "en")}</Td>
              <Td>
                {r.actor_name ?? <span className="text-muted-foreground">System</span>}
                {r.actor_role && <span className="block text-xs text-muted-foreground">{r.actor_role.replaceAll("_", " ")}</span>}
              </Td>
              <Td><span className="font-medium">{actionLabel(r.action)}</span><span className="block text-xs text-muted-foreground">{entityLabel(r.entity_type)}</span></Td>
              <Td className="max-w-[14rem] text-xs break-all">
                {href ? <Link href={href} className="text-primary hover:underline">{r.entity_label || r.entity_id}</Link> : (r.entity_label || r.entity_id || "—")}
              </Td>
              <Td className="max-w-md text-xs break-words text-muted-foreground">
                {[...changes, ...notes].length === 0 ? "—" : (
                  <ul className="space-y-0.5">{[...changes, ...notes].map((x) => <li key={x}>{x}</li>)}</ul>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-4 flex gap-2">
        {before && <Button variant="outline" asChild><Link href={`/admin/activity?${params}`}>Newest</Link></Button>}
        {last && (rows?.length ?? 0) === PAGE && (
          <Button variant="outline" asChild><Link href={`/admin/activity?${new URLSearchParams({ ...Object.fromEntries(params), before: String(last.id) })}`}>Older</Link></Button>
        )}
      </div>
    </>
  );
}
