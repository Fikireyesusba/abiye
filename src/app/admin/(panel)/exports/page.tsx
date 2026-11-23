import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, fieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { clearTickets } from "@/lib/admin/support-actions";
import type { Permission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guards";
import { zoneToday } from "@/lib/datetime";

export const metadata: Metadata = { title: "Excel exports" };

type Item = { title: string; text: string; href: string; perm: Permission; dated?: boolean; extra?: Record<string, string>; clear?: string };
const ITEMS: Item[] = [
  { title: "Orders", text: "Every order with items, customer, delivery, payment and status.", href: "/admin/orders/export", perm: "orders.view_all", dated: true, extra: { status: "all" } },
  { title: "Payments", text: "Bank payments and wallet top-ups with reference, bank account and decision.", href: "/admin/payments/export", perm: "payments.view", dated: true, extra: { status: "all", topups: "1" } },
  { title: "Customers", text: "Every customer account: User ID, name, email, phone, sex, date of birth, orders, balance, sign-in.", href: "/admin/exports/download", perm: "customers.view", extra: { kind: "customers" } },
  { title: "Products & stock", text: "All products with prices, stock levels, low-stock level, status and ratings.", href: "/admin/exports/download", perm: "products.view", extra: { kind: "products" } },
  { title: "Wallet", text: "Current customer balances and the top-ups of the chosen dates.", href: "/admin/exports/download", perm: "wallet.manage", dated: true, extra: { kind: "wallet" } },
  { title: "Printing jobs", text: "Printing jobs with options, pages, price and status.", href: "/admin/exports/download", perm: "printing.view", dated: true, extra: { kind: "printing" } },
  { title: "Support tickets", text: "Tickets with topic, details, status, staff, messages and the customer's rating.", href: "/admin/exports/download", perm: "support.view", dated: true, extra: { kind: "support" }, clear: "tickets" },
  { title: "Staff performance", text: "KPIs per staff member with their targets and % reached.", href: "/admin/exports/download", perm: "kpi.view", dated: true, extra: { kind: "kpi" } },
  { title: "Activity log", text: "Who did what and when (with User IDs).", href: "/admin/activity/export", perm: "audit.view", dated: true, extra: { type: "" }, clear: "/admin/activity" },
  { title: "Notifications", text: "Every message sent (Telegram, email, phone).", href: "/admin/notifications/export", perm: "settings.manage", dated: true, clear: "/admin/notifications?tab=messages" },
  { title: "Signed-in users", text: "Who is signed in, last sign-in of every account, app installs.", href: "/admin/users/export", perm: "security.manage", extra: { tab: "last" } },
  { title: "Everything", text: "One file with a sheet for every area (before a reset).", href: "/admin/data/export", perm: "data.manage" },
];

/** Every Excel export in one place. Each export is recorded and a copy goes to the receipts Telegram group. */
export default async function ExportsPage() {
  const ctx = await requirePermission("orders.view_all", "payments.view", "customers.view", "products.view", "wallet.manage", "printing.view",
    "support.view", "audit.view", "settings.manage", "security.manage", "data.manage", "kpi.view");
  if (ctx.role !== "super_admin") notFound(); // Excel downloads: Super Admin only
  const today = zoneToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const items = ITEMS.filter((i) => ctx.permissions.has(i.perm));
  return (
    <>
      <PageHeader title="Excel exports" description="Download your data as Excel (.xlsx) — Super Admin only. Every export is recorded in the activity log and a copy of the file is sent to the receipts Telegram group. Data can only be cleared after it was exported." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="exports">
        {items.map((i) => (
          <Panel key={i.title} title={i.title}>
            <p className="mb-3 text-sm text-muted-foreground">{i.text}</p>
            <form method="get" action={i.href} className="flex flex-wrap items-end gap-2">
              {Object.entries(i.extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {i.dated && (
                <>
                  <label className="text-xs">From<input type="date" name="from" required defaultValue={monthStart} max={today} className={`${fieldClass} mt-1 block h-9`} /></label>
                  <label className="text-xs">To<input type="date" name="to" required defaultValue={today} max={today} className={`${fieldClass} mt-1 block h-9`} /></label>
                </>
              )}
              <Button type="submit" size="sm" data-testid={`export-${i.title}`}><Download /> Excel</Button>
            </form>
            {i.clear === "tickets" && ctx.permissions.has("support.manage") && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-destructive">Clear closed tickets</summary>
                <p className="my-2 text-xs text-muted-foreground">Deletes resolved / closed tickets opened in these dates. First download the Support tickets export for the same (or wider) dates; clearing is allowed for 30 minutes after it.</p>
                <ActionForm action={clearTickets} submitLabel="Clear closed tickets" variant="destructive" size="sm" confirm="Permanently delete the closed tickets of these dates?" className="flex flex-wrap items-end gap-2 space-y-0">
                  <label className="text-xs">From<input type="date" name="from" required max={today} className={`${fieldClass} mt-1 block h-9`} /></label>
                  <label className="text-xs">To<input type="date" name="to" required max={today} className={`${fieldClass} mt-1 block h-9`} /></label>
                </ActionForm>
              </details>
            )}
            {i.clear?.startsWith("/") && <p className="mt-3 text-xs"><Link href={i.clear} className="text-primary hover:underline">Clear entries (after exporting) →</Link></p>}
          </Panel>
        ))}
      </div>
    </>
  );
}
