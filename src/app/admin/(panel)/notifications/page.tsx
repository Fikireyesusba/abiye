import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { retryAllFailed, retryNotification, saveTelegramFeed, sendGroupTest, sendSecurityTest, sendTestNotification } from "@/lib/admin/notification-actions";
import { describe } from "@/lib/telegram/format";
import { archivePastReceipts, saveReceiptArchive, sendArchiveTest } from "@/lib/admin/archive-actions";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { groupConfig, securityTelegramConfig, telegramConfig } from "@/lib/telegram/dispatch";
import { emailConfigured } from "@/lib/email/dispatch";
import { pushConfigured, pushSetupProblems } from "@/lib/push/dispatch";
import { getSiteSettings } from "@/lib/catalog/settings";
import { VapidKeyGenerator } from "@/components/admin/vapid-keys";

export const metadata: Metadata = { title: "Notifications" };
export const maxDuration = 60; // "Send past receipts" keeps emailing for up to ~50 s

type Row = { id: number; channel: string; event_type: string; status: "pending" | "processing" | "sent" | "failed" | "dead"; attempts: number; max_attempts: number;
  last_error: string | null; created_at: string; sent_at: string | null; reference: string | null };
const CATEGORIES = [
  { key: "orders", label: "Orders & printing", hint: "Order placed, being prepared, ready, out for delivery, collected, expired, cancelled; printing requests and steps", group: "orders" },
  { key: "payments", label: "Payments & wallet", hint: "Receipts to verify, payments verified / rejected, top-ups, orders paid with balance", group: "orders" },
  { key: "stock", label: "Stock", hint: "Low stock and sold out", group: "stock" },
  { key: "receipts", label: "Receipt files", hint: "Every verified / rejected receipt, with the file", group: "receipts" },
  { key: "security", label: "Security & admin", hint: "Security events, 🚨 alerts, admin sign-ins and sensitive admin actions", group: "security" },
  { key: "customers", label: "Customer messages", hint: "Emails and phone notifications to customers, receipt-archive emails (and their copies in Telegram)", group: "orders" },
  { key: "other", label: "Tests", hint: "Test messages", group: "orders" },
] as const;
function categoryOf(r: Pick<Row, "channel" | "event_type">): (typeof CATEGORIES)[number]["key"] {
  if (r.channel !== "telegram" || r.event_type === "notification_copy") return "customers";
  if (["security_event", "security_alert", "admin_action", "security_test"].includes(r.event_type)) return "security";
  if (["new_order", "payment_resubmitted", "payment_verified", "payment_rejected", "wallet_topup", "wallet_order_paid"].includes(r.event_type)) return "payments";
  if (["low_stock", "out_of_stock", "stock_test"].includes(r.event_type)) return "stock";
  if (["receipt_record", "receipts_test"].includes(r.event_type)) return "receipts";
  if (r.event_type === "test_message") return "other";
  return "orders";
}
// Names in the list (the detailed name is in each Telegram message).
const LIST_LABEL: Record<string, string> = {
  security_event: "Security event", security_alert: "🚨 Security alert", admin_action: "Admin action",
  notification_copy: "Copy of a customer message", security_test: "Test message (security group)", test_message: "Test message (orders group)",
  stock_test: "Test message (stock group)", receipts_test: "Test message (receipts group)", receipt_record: "Receipt file",
};
const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram", email: "Email", push: "Phone", archive: "Archive email" };
const TONE = { sent: "success", pending: "secondary", processing: "info", failed: "warning", dead: "destructive" } as const;

export default async function NotificationsPage() {
  await requirePermission("settings.manage");
  const configured = !!telegramConfig();
  const securityConfigured = !!securityTelegramConfig();
  const stockConfigured = !!groupConfig("stock");
  const receiptsConfigured = !!groupConfig("receipts");
  const emailOn = emailConfigured();
  const pushOn = pushConfigured();
  const pushProblems = pushSetupProblems();
  const settings = await getSiteSettings();
  const supabase = await createSupabaseServerClient();
  const { data: rowsRaw } = await supabase.rpc("admin_notifications", { p_limit: 600 });
  const rows = (rowsRaw ?? []) as Row[];
  const isProblem = (r: Row) => r.status === "failed" || (r.status === "dead" && !r.last_error?.startsWith("skipped"));
  const problems = rows.filter(isProblem).length;
  const { data: archiveRaw } = await supabase.rpc("admin_receipt_archive_status");
  const archive = (archiveRaw ?? null) as { email: string | null; sent: number; waiting: number; dead: number; last_sent_at: string | null; last_error: string | null } | null;
  const { data: feedRaw } = await supabase.rpc("admin_telegram_feed");
  const feed = (feedRaw ?? null) as { security: boolean; admin: boolean; notifications: boolean; order_progress?: boolean; printing_requests?: boolean } | null;
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
      <h2 className="mb-3 text-base font-semibold">Staff Telegram groups</h2>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel title="Orders & payments group">
          <p className="mb-2 flex items-center gap-2 text-sm">
            {configured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {configured ? "Connected (TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID)." : "Not connected — set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in Vercel, then redeploy."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">What needs you: receipts to verify (new and resubmitted), wallet top-ups to verify, printing requests to quote. Order progress and copies of customer messages can be switched on below.</p>
          <ActionForm action={sendTestNotification} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
        <Panel title="Security group">
          <p className="mb-2 flex items-center gap-2 text-sm">
            {securityConfigured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {securityConfigured ? "Connected (TELEGRAM_SECURITY_BOT_TOKEN / TELEGRAM_SECURITY_CHAT_ID)." : "Not connected — create a second bot and group, then set TELEGRAM_SECURITY_BOT_TOKEN and TELEGRAM_SECURITY_CHAT_ID in Vercel and redeploy. Until then security messages are kept 24 hours, then dropped."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">Security events (failed / successful admin sign-ins, wrong codes, blocked attempts, rate limits), 🚨 high-risk alerts, and sensitive admin actions.</p>
          <ActionForm action={sendSecurityTest} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
        <Panel title="Stock group">
          <p className="mb-2 flex items-center gap-2 text-sm">
            {stockConfigured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {stockConfigured ? "Connected (TELEGRAM_STOCK_BOT_TOKEN / TELEGRAM_STOCK_CHAT_ID)." : "Not connected — until TELEGRAM_STOCK_BOT_TOKEN and TELEGRAM_STOCK_CHAT_ID are set, stock alerts go to the orders & payments group."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">Low stock (at each product&apos;s alert level) and sold out. Stock alerts are no longer emailed.</p>
          <ActionForm action={sendGroupTest} hidden={{ group: "stock" }} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
        <Panel title="Receipts group">
          <p className="mb-2 flex items-center gap-2 text-sm">
            {receiptsConfigured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {receiptsConfigured ? "Connected (TELEGRAM_RECEIPTS_BOT_TOKEN / TELEGRAM_RECEIPTS_CHAT_ID)." : "Not connected — set TELEGRAM_RECEIPTS_BOT_TOKEN and TELEGRAM_RECEIPTS_CHAT_ID in Vercel and redeploy. Until then receipt files wait 2 days, then are dropped (the email archive still gets them)."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">The receipt file of every verified or rejected payment and top-up, with order, amount, reference, bank account, customer, who decided and why — in addition to the receipt-archive email.</p>
          <ActionForm action={sendGroupTest} hidden={{ group: "receipts" }} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
      </div>
      {feed && (
        <Panel title="Telegram activity feed" className="mb-6">
          <p className="mb-3 text-sm text-muted-foreground">Receipts and top-ups to verify are always sent to the orders & payments group; stock alerts and receipt files to their groups. Choose the rest below. Each message shows its <strong>service</strong> and <strong>event</strong> name with the details; identical security events within 5 minutes are grouped.</p>
          <ActionForm action={saveTelegramFeed} submitLabel="Save" size="sm" className="space-y-2">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="security" defaultChecked={feed.security} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><strong>Security events and alerts</strong> → security group</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="admin" defaultChecked={feed.admin} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><strong>Sensitive admin actions</strong> (blocking, staff / roles / bank / settings changes, deactivations, wallet corrections, exports, resets) → security group</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="printing_requests" defaultChecked={feed.printing_requests ?? true} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><strong>Printing requests to quote</strong> → orders & payments group</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="order_progress" defaultChecked={feed.order_progress ?? false} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><strong>Order &amp; printing progress</strong> (placed, payment verified / rejected, preparing, ready, out for delivery, collected, cancelled, expired, paid with balance) → orders & payments group</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="notifications" defaultChecked={feed.notifications} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><strong>Copies of customer messages</strong> (emails, phone notifications, receipt archive — sent ✓ / failed ✗) → orders & payments group</span></label>
          </ActionForm>
        </Panel>
      )}

      <h2 className="mb-1 text-base font-semibold">Notifications by category</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        The latest {rows.length} messages, newest first. Click a category to open it. Failed messages are retried automatically (1, 2, 4… minutes); after the last attempt press <strong>Retry</strong>.
        {problems > 0 && <span className="font-medium text-destructive"> {problems} need attention.</span>}
      </p>
      {problems > 0 && (
        <div className="mb-3 space-y-2">
          {rows.some((r) => isProblem(r) && /not enough rights|chat not found|bot was kicked|forbidden/i.test(r.last_error ?? "")) && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              Telegram says the bot <strong>cannot post in the group</strong>. In Telegram: open the group → Edit → Administrators → Add Admin → choose the bot →
              switch every right off → Save (admins can always post). Or allow members to send messages. Then press <strong>Retry all failed</strong>.
            </p>
          )}
          <ActionForm action={retryAllFailed} submitLabel={`Retry all failed (${problems})`} variant="outline" size="sm" />
        </div>
      )}
      <div className="space-y-3">
        {CATEGORIES.map((c) => {
          const list = rows.filter((r) => categoryOf(r) === c.key);
          if (!list.length && c.key === "other") return null;
          const failed = list.filter(isProblem).length;
          const waiting = list.filter((r) => r.status === "pending" || r.status === "processing").length;
          return (
            <details key={c.key} open={failed > 0} className="rounded-lg border bg-card" data-category={c.key}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-4">
                <span className="font-medium">{c.label}</span>
                <Badge variant="secondary">{list.length}</Badge>
                {waiting > 0 && <Badge variant="info">{waiting} waiting</Badge>}
                {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
                <span className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">{c.hint}{c.key !== "customers" && ` · ${({ security: "Security group", stock: stockConfigured ? "Stock group" : "Orders & payments group (until a stock bot is set)", receipts: "Receipts group", orders: "Orders & payments group" } as Record<string, string>)[c.group]}`}</span>
              </summary>
              <div className="border-t p-2">
                <Table head={["#", "Event", "Via", "About", "Status", "Attempts", "Created", "Last error", ""]} empty="Nothing yet.">
                  {list.map((r) => (
                    <tr key={r.id}>
                      <Td className="text-xs text-muted-foreground tabular-nums">{r.id}</Td>
                      <Td>{LIST_LABEL[r.event_type] ?? describe({ id: r.id, event_type: r.event_type, payload: {}, attachment_bucket: null, attachment_path: null })[1]}</Td>
                      <Td className="text-xs">{CHANNEL_LABEL[r.channel] ?? r.channel}</Td>
                      <Td className="max-w-[12rem] font-mono text-xs break-all">{r.reference ?? "—"}</Td>
                      <Td><Badge variant={TONE[r.status]}>{r.status === "dead" && r.last_error?.startsWith("skipped") ? "skipped" : r.status}</Badge></Td>
                      <Td className="tabular-nums">{r.attempts}/{r.max_attempts}</Td>
                      <Td className="text-xs text-muted-foreground">{formatDateTime(r.created_at, "en")}{r.sent_at && <span className="block">sent {formatDateTime(r.sent_at, "en")}</span>}</Td>
                      <Td className="max-w-xs text-xs break-words text-destructive">{r.last_error}</Td>
                      <Td>{isProblem(r) && <ActionForm action={retryNotification} hidden={{ id: String(r.id) }} submitLabel="Retry" size="sm" variant="outline" />}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
