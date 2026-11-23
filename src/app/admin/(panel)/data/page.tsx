import type { Metadata } from "next";
import { Download, ShieldAlert } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { DatabaseUpdateNeeded, PageHeader, Panel, isMissingDbFunction } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetTestData } from "@/lib/admin/data-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Export & reset" };
export const maxDuration = 60;

const REMOVED = ["All orders, order items, payment receipts and status history", "All printing jobs and their documents", "All customer accounts (sign-in), customers and addresses",
  "Wallet top-ups and balance history", "Product reviews and back-in-stock requests", "Saved baskets and phone-notification subscriptions",
  "Queued messages, security events and the activity log (except reset records)"];
const KEPT = ["Products, photos, categories and current stock levels", "Promotions and homepage banners", "Settings, bank accounts, delivery zones and printing prices",
  "Staff accounts and their two-step login", "Blocked emails"];

export default async function DataPage() {
  const ctx = await requirePermission("data.manage");
  const supabase = await createSupabaseServerClient();
  const { data: phrase, error } = await supabase.rpc("admin_reset_phrase");
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Export & reset" migration="20261120000034_data_export_reset.sql" />;
  const [{ data: lastExport }, { data: resets }] = await Promise.all([
    supabase.from("audit_logs").select("created_at").eq("action", "export_all").eq("actor_id", ctx.userId).order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("audit_logs").select("id, created_at, metadata, actor_id").eq("action", "data_reset").order("id", { ascending: false }).limit(10),
  ]);
  const exportedRecently = !!lastExport && Date.parse(lastExport.created_at) > new Date().getTime() - 30 * 60 * 1000;

  return (
    <>
      <PageHeader title="Export & reset" description="Download all your data, and clear test data before launch. Super Admin only." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="1. Export everything">
          <p className="mb-3 text-sm text-muted-foreground">One Excel file with a sheet for every area: orders, items, payments, printing, customers, wallet, reviews, products, categories, inventory, promotions, settings, staff, activity log and more. Secrets (access codes) and files (receipts, documents) are not included. Each export is recorded.</p>
          {ctx.role === "super_admin" ? <Button asChild><a href="/admin/data/export"><Download /> Export everything (.xlsx)</a></Button> : <p className="text-sm text-muted-foreground">Only the Super Admin can download Excel files.</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            {lastExport ? <>Your last export: {formatDateTime(lastExport.created_at, "en")}{exportedRecently ? " ✓ (reset allowed for 30 minutes)" : ""}</> : "You have not exported yet."}
          </p>
        </Panel>
        <Panel title="2. Reset test data" className="border-destructive/40">
          <div className="mb-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="mb-1 font-medium text-destructive">Permanently removed</p><ul className="list-disc space-y-0.5 pl-5">{REMOVED.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><p className="mb-1 font-medium text-success">Kept</p><ul className="list-disc space-y-0.5 pl-5">{KEPT.map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">Order numbers start again at ET-10001. The reset is recorded permanently. Use this before launch — it cannot be undone.</p>
          {!exportedRecently ? (
            <p className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm"><ShieldAlert className="size-4 text-destructive" aria-hidden /> Download “Export everything” first; the reset unlocks for 30 minutes after it.</p>
          ) : (
            <ActionForm action={resetTestData} submitLabel="Reset test data" variant="destructive" keepSuccess
              confirm="Last check: permanently delete all orders, payments, printing jobs, customer accounts and test logs?">
              <label className="block text-sm">Type <code className="rounded bg-muted px-1 font-semibold">{phrase}</code>
                <Input name="phrase" required autoComplete="off" spellCheck={false} className="mt-1" aria-label="Confirmation phrase" />
              </label>
              <label className="block text-sm">Authenticator code
                <Input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" className="mt-1 w-40" aria-label="Authenticator code" />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="understood" required className="size-4 accent-[var(--destructive)]" /> I understand this cannot be undone</label>
            </ActionForm>
          )}
        </Panel>
      </div>
      {(resets ?? []).length > 0 && (
        <Panel title="Previous resets" className="mt-6">
          <ul className="space-y-1 text-sm">
            {(resets ?? []).map((r) => {
              const m = (r.metadata ?? {}) as Record<string, number>;
              return <li key={r.id}>{formatDateTime(r.created_at, "en")} — {m.orders ?? 0} orders, {m.printing_jobs ?? 0} printing jobs, {m.customer_accounts ?? 0} customer accounts removed</li>;
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}
