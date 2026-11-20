import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { retryNotification, sendTestNotification } from "@/lib/admin/notification-actions";
import { archivePastReceipts, saveReceiptArchive, sendArchiveTest } from "@/lib/admin/archive-actions";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { telegramConfig } from "@/lib/telegram/dispatch";
import { emailConfigured } from "@/lib/email/dispatch";
import { pushConfigured, pushSetupProblems } from "@/lib/push/dispatch";
import { getSiteSettings } from "@/lib/catalog/settings";
import { VapidKeyGenerator } from "@/components/admin/vapid-keys";

export const metadata: Metadata = { title: "Notifications" };
export const maxDuration = 60; // "Send past receipts" keeps emailing for up to ~50 s

const LABEL: Record<string, string> = {
  new_order: "New order", payment_resubmitted: "Payment resubmitted", printing_request: "Printing request",
  payment_verified: "Payment verified", payment_rejected: "Payment rejected", order_cancelled: "Order cancelled", test_message: "Test",
  receipt_archive: "Receipt archive",
};
const TONE = { sent: "success", pending: "secondary", processing: "info", failed: "warning", dead: "destructive" } as const;

export default async function NotificationsPage() {
  await requirePermission("settings.manage");
  const configured = !!telegramConfig();
  const emailOn = emailConfigured();
  const pushOn = pushConfigured();
  const pushProblems = pushSetupProblems();
  const settings = await getSiteSettings();
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase.rpc("admin_notifications", { p_limit: 100 });
  const problems = (rows ?? []).filter((r) => r.status === "failed" || r.status === "dead").length;
  const { data: archiveRaw } = await supabase.rpc("admin_receipt_archive_status");
  const archive = (archiveRaw ?? null) as { email: string | null; sent: number; waiting: number; dead: number; last_sent_at: string | null; last_error: string | null } | null;
  const today = new Date(new Date().getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Notifications" description="Staff alerts go to your private Telegram chat; customers get emails and (if they turn them on) phone notifications. Orders are never affected if a service is down." />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel title="Customer emails">
          <p className="flex items-center gap-2 text-sm">
            {emailOn ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {emailOn ? "Configured (Resend). Customers get an email at every order step." : "Not configured — set RESEND_API_KEY and EMAIL_FROM in Vercel (docs/DEPLOYMENT.md §9)."}
          </p>
        </Panel>
        <Panel title="Customer phone notifications">
          <p className="mb-3 flex items-center gap-2 text-sm">
            {pushOn ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {pushOn ? "Configured. Customers can turn them on in My account and on their order page." : "Not configured yet. Create the keys below and add them to Vercel."}
          </p>
          {!pushOn && (
            <div className="mb-3 space-y-1 rounded-md bg-muted/60 p-3 text-sm">
              <p className="font-medium">What the website sees right now:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-destructive">{pushProblems.map((p) => <li key={p}>{p}</li>)}</ul>
              <p className="text-muted-foreground">
                {pushProblems.length === 3
                  ? "If you already added them in Vercel: make sure “Production” is ticked for each, then Deployments → ⋯ → Redeploy."
                  : "Fix the listed variable in Vercel (Production), then Redeploy."}
              </p>
            </div>
          )}
          {!pushOn && <VapidKeyGenerator suggestedSubject={`mailto:${settings.contact.email || "orders@example.com"}`} />}
        </Panel>
      </div>
      <h2 className="mb-3 text-base font-semibold">Payment receipt archive</h2>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel title="Archive address">
          <p className="mb-3 flex items-center gap-2 text-sm">
            {archive?.email && emailOn ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {!archive ? "Database update needed (migration 20261120000030)." : archive.email
              ? (emailOn ? <>Every verified or rejected receipt is emailed to <strong>{archive.email}</strong> with the receipt attached.</> : "Address saved, but email is not configured in Vercel yet — receipts wait in the queue.")
              : "Off. Enter an address you control (e.g. a separate Gmail used only for receipts)."}
          </p>
          {archive && (
            <ActionForm action={saveReceiptArchive} submitLabel="Save address" size="sm" className="space-y-2">
              <Input type="email" name="email" defaultValue={archive.email ?? ""} placeholder="receipts@example.com" maxLength={254} aria-label="Archive email address" />
              <p className="text-xs text-muted-foreground">Only a Super Admin can change this. The old address gets a notice when it changes, and the change is in the Activity log. Leave empty to turn archiving off.</p>
            </ActionForm>
          )}
          {archive?.email && <div className="mt-3"><ActionForm action={sendArchiveTest} submitLabel="Send test email" variant="outline" size="sm" /></div>}
        </Panel>
        <Panel title="Archive status">
          {archive ? (
            <>
              <dl className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-md bg-muted/60 p-2"><dt className="text-xs text-muted-foreground">Archived</dt><dd className="text-lg font-semibold tabular-nums">{archive.sent}</dd></div>
                <div className="rounded-md bg-muted/60 p-2"><dt className="text-xs text-muted-foreground">Waiting</dt><dd className="text-lg font-semibold tabular-nums">{archive.waiting}</dd></div>
                <div className="rounded-md bg-muted/60 p-2"><dt className="text-xs text-muted-foreground">Failed</dt><dd className={`text-lg font-semibold tabular-nums ${archive.dead ? "text-destructive" : ""}`}>{archive.dead}</dd></div>
              </dl>
              {archive.last_sent_at && <p className="mt-2 text-xs text-muted-foreground">Last archived {formatDateTime(archive.last_sent_at, "en")}</p>}
              {archive.last_error && <p className="mt-1 text-xs break-words text-destructive">Last error: {archive.last_error}</p>}
              {archive.email && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium">Send past receipts</summary>
                  <ActionForm action={archivePastReceipts} submitLabel="Send receipts" size="sm" variant="outline" className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="text-sm">Decided from<input type="date" name="from" required defaultValue="2026-01-01" max={today} className={`${fieldClass} mt-1 block`} /></label>
                    <label className="text-sm">To<input type="date" name="to" required defaultValue={today} max={today} className={`${fieldClass} mt-1 block`} /></label>
                  </ActionForm>
                  <p className="mt-1 text-xs text-muted-foreground">For receipts verified or rejected before the archive was set up. Receipts already archived are never sent twice.</p>
                </details>
              )}
            </>
          ) : <p className="text-sm text-muted-foreground">—</p>}
        </Panel>
      </div>
      <h2 className="mb-3 text-base font-semibold">Staff Telegram alerts</h2>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel title="Connection">
          <p className="mb-3 flex items-center gap-2 text-sm">
            {configured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {configured ? "Bot token and chat id are configured." : "Not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in the hosting environment. Messages stay queued until then."}
          </p>
          <ActionForm action={sendTestNotification} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
        <Panel title="Delivery">
          <p className="text-sm text-muted-foreground">
            Messages are sent right after each event. Failed sends are retried automatically with increasing delays (1, 2, 4… minutes),
            and marked <strong>dead</strong> after 8 attempts — fix the cause, then press Retry.
          </p>
          {problems > 0 && <p className="mt-2 text-sm font-medium text-destructive">{problems} message(s) need attention.</p>}
        </Panel>
      </div>
      <Table head={["#", "Event", "Reference", "Status", "Attempts", "Created", "Last error", ""]} empty="No notifications yet.">
        {(rows ?? []).map((r) => (
          <tr key={r.id}>
            <Td className="text-xs text-muted-foreground tabular-nums">{r.id}</Td>
            <Td>{LABEL[r.event_type] ?? r.event_type}</Td>
            <Td className="font-mono text-xs">{r.reference ?? "—"}</Td>
            <Td><Badge variant={TONE[r.status]}>{r.status}</Badge></Td>
            <Td className="tabular-nums">{r.attempts}/{r.max_attempts}</Td>
            <Td className="text-xs text-muted-foreground">{formatDateTime(r.created_at, "en")}{r.sent_at && <span className="block">sent {formatDateTime(r.sent_at, "en")}</span>}</Td>
            <Td className="max-w-xs text-xs break-words text-destructive">{r.last_error}</Td>
            <Td>{(r.status === "failed" || r.status === "dead") && <ActionForm action={retryNotification} hidden={{ id: String(r.id) }} submitLabel="Retry" size="sm" variant="outline" />}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
