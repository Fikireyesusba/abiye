import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { clearNotifications, retryAllFailed, retryNotification, savePendingPaymentAlerts, saveTelegramFeed, sendGroupTest, sendSecurityTest, sendTestNotification } from "@/lib/admin/notification-actions";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describe } from "@/lib/telegram/format";
import { archivePastReceipts, saveReceiptArchive, sendArchiveTest } from "@/lib/admin/archive-actions";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime, zoneDayStartIso, zoneToday } from "@/lib/datetime";
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
  { key: "payments", label: "Payments & wallet", hint: "Receipts and top-ups waiting for approval, completed payments (verified, paid with balance)", group: "orders" },
  { key: "orders", label: "Orders & printing", hint: "Printing requests to quote (and older order-step messages)", group: "orders" },
  { key: "stock", label: "Stock", hint: "Low stock and sold out", group: "stock" },
  { key: "receipts", label: "Receipt files", hint: "Every verified / rejected receipt, with the file", group: "receipts" },
  { key: "printing", label: "Printing documents", hint: "Each document of a printing job, once its payment is approved", group: "printing" },
  { key: "security", label: "Security & admin", hint: "Security events, 🚨 alerts, admin sign-ins and sensitive admin actions", group: "security" },
  { key: "customers", label: "Customer messages", hint: "Emails and phone notifications to customers, receipt-archive emails (and their copies in Telegram)", group: "orders" },
  { key: "other", label: "Tests", hint: "Test messages", group: "orders" },
] as const;
function categoryOf(r: Pick<Row, "channel" | "event_type">): (typeof CATEGORIES)[number]["key"] {
  if (r.channel !== "telegram" || r.event_type === "notification_copy") return "customers";
  if (["security_event", "security_alert", "admin_action", "security_test"].includes(r.event_type)) return "security";
  if (["new_order", "payment_resubmitted", "payment_verified", "payment_rejected", "wallet_topup", "topup_verified", "topup_rejected", "wallet_order_paid"].includes(r.event_type)) return "payments";
  if (["low_stock", "out_of_stock", "stock_test"].includes(r.event_type)) return "stock";
  if (["receipt_record", "receipts_test"].includes(r.event_type)) return "receipts";
  if (["printing_document", "printing_test"].includes(r.event_type)) return "printing";
  if (r.event_type === "test_message") return "other";
  return "orders";
}
// Names in the list (the detailed name is in each Telegram message).
const LIST_LABEL: Record<string, string> = {
  security_event: "Security event", security_alert: "🚨 Security alert", admin_action: "Admin action",
  notification_copy: "Copy of a customer message", security_test: "Test message (security group)", test_message: "Test message (orders group)",
  stock_test: "Test message (stock group)", receipts_test: "Test message (receipts group)", receipt_record: "Receipt file",
  printing_test: "Test message (printing group)", printing_document: "Document to print",
};
const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram", email: "Email", push: "Phone", archive: "Archive email" };
const TONE = { sent: "success", pending: "secondary", processing: "info", failed: "warning", dead: "destructive" } as const;

export default async function NotificationsPage({ searchParams }: PageProps<"/admin/notifications">) {
  await requirePermission("settings.manage");
  const configured = !!telegramConfig();
  const securityConfigured = !!securityTelegramConfig();
  const stockConfigured = !!groupConfig("stock");
  const receiptsConfigured = !!groupConfig("receipts");
  const printingConfigured = !!groupConfig("printing");
  const supportConfigured = !!groupConfig("support");
  const emailOn = emailConfigured();
  const pushOn = pushConfigured();
  const pushProblems = pushSetupProblems();
  const settings = await getSiteSettings();
  const supabase = await createSupabaseServerClient();
  // Search (text + Warsaw dates) or the latest 600.
  const sq = await searchParams;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const nq = one(sq.q).trim().slice(0, 100);
  const nFrom = DAY.test(one(sq.from)) ? one(sq.from) : "";
  const nTo = DAY.test(one(sq.to)) ? one(sq.to) : "";
  const searching = !!(nq || nFrom || nTo);
  const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const { data: rowsRaw } = searching
    ? await supabase.rpc("admin_notifications_search", {
        p_search: nq || undefined, p_limit: 2000,
        p_from: nFrom ? zoneDayStartIso(nFrom) : undefined, p_to: nTo ? zoneDayStartIso(nextDay(nTo)) : undefined })
    : await supabase.rpc("admin_notifications", { p_limit: 600 });
  const rows = (rowsRaw ?? []) as Row[];
  const isProblem = (r: Row) => r.status === "failed" || (r.status === "dead" && !r.last_error?.startsWith("skipped"));
  const problems = rows.filter(isProblem).length;
  const { data: archiveRaw } = await supabase.rpc("admin_receipt_archive_status");
  const archive = (archiveRaw ?? null) as { email: string | null; sent: number; waiting: number; dead: number; last_sent_at: string | null; last_error: string | null } | null;
  const { data: feedRaw } = await supabase.rpc("admin_telegram_feed");
  const feed = (feedRaw ?? null) as { security: boolean; admin: boolean; notifications: boolean; order_progress?: boolean; printing_requests?: boolean; pending_payments?: boolean } | null;
  const today = zoneToday();
  const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const sp = sq;
  const TABS = [
    { key: "messages", label: "Messages", count: problems },
    { key: "telegram", label: "Telegram groups & alerts" },
    { key: "customers", label: "Customer emails & phone" },
    { key: "archive", label: "Receipt archive" },
  ];
  const tab = pickTab(TABS, sp.tab);
  const cats = CATEGORIES.map((c) => {
    const list = rows.filter((r) => categoryOf(r) === c.key);
    return { ...c, list, failed: list.filter(isProblem).length, waiting: list.filter((r) => r.status === "pending" || r.status === "processing").length };
  }).filter((c) => c.list.length || c.key !== "other");
  // Opens on the first category with a failed message, else the first one.
  const cat = cats.find((c) => c.key === (Array.isArray(sp.cat) ? sp.cat[0] : sp.cat)) ?? cats.find((c) => c.failed) ?? cats[0];

  return (
    <>
      <PageHeader title="Notifications" description="Staff alerts go to your private Telegram chat; customers get emails and (if they turn them on) phone notifications. Orders are never affected if a service is down." />
      <SubTabs base="/admin/notifications" tabs={TABS} active={tab} />
      {tab === "customers" && (
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
      )}
      {tab === "archive" && (
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
      )}
      {tab === "telegram" && (<>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel title="Orders & payments group">
          <p className="mb-2 flex items-center gap-2 text-sm">
            {configured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {configured ? "Connected (TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID)." : "Not connected — set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in Vercel, then redeploy."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">Payments only: receipts and wallet top-ups waiting for your approval, and completed payments (verified, or paid with balance) — for orders and printing. Plus printing requests that need a price (switch below). No order steps or copies of customer messages.</p>
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
          <p className="mb-3 text-xs text-muted-foreground">The receipt file of every verified or rejected payment and top-up, with order, amount, reference, bank account, customer, who decided and why — in addition to the receipt-archive email. Also a copy of every Excel export (orders, payments, activity, notifications, sales reports, full export).</p>
          <ActionForm action={sendGroupTest} hidden={{ group: "receipts" }} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
        <Panel title="Printing group">
          <p className="mb-2 flex items-center gap-2 text-sm">
            {printingConfigured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {printingConfigured ? "Connected (TELEGRAM_PRINTING_BOT_TOKEN / TELEGRAM_PRINTING_CHAT_ID)." : "Not connected — create a bot and a group for printing, then set TELEGRAM_PRINTING_BOT_TOKEN and TELEGRAM_PRINTING_CHAT_ID in Vercel and redeploy. Until then documents wait 2 days, then are dropped (they stay on the printing job page)."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">Each document of a printing job, as a file ready to print, with the print options and customer — sent only once the payment is approved. Nothing is sent before that; if the payment is rejected the documents are deleted.</p>
          <ActionForm action={sendGroupTest} hidden={{ group: "printing" }} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
        <Panel title="Support group">
          <p className="mb-2 flex items-center gap-2 text-sm">
            {supportConfigured ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            {supportConfigured ? "Connected (TELEGRAM_SUPPORT_BOT_TOKEN / TELEGRAM_SUPPORT_CHAT_ID)." : "Not connected — create a bot and a group for support, then set TELEGRAM_SUPPORT_BOT_TOKEN and TELEGRAM_SUPPORT_CHAT_ID in Vercel and redeploy. Until then tickets are only in Support tickets."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">Every new support ticket (topic, order number, details, customer and User ID) and every customer reply.</p>
          <ActionForm action={sendGroupTest} hidden={{ group: "support" }} submitLabel="Send test message" variant="outline" size="sm" />
        </Panel>
      </div>
      {feed && (
        <Panel title="Telegram activity feed" className="mb-6">
          <p className="mb-3 text-sm text-muted-foreground">Approved payments go to the orders & payments group (payments waiting for approval only if switched on below); stock alerts and receipt files to their groups. Choose the rest below. Each message shows its <strong>service</strong> and <strong>event</strong> name with the details; identical security events within 5 minutes are grouped.</p>
          <ActionForm action={savePendingPaymentAlerts} submitLabel="Save" size="sm" className="mb-4 space-y-2 border-b pb-4">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="pending_payments" defaultChecked={feed.pending_payments ?? false} className="mt-0.5 size-4 accent-[var(--primary)]" data-testid="pending-payments-toggle" />
              <span><strong>Also alert order payments waiting for approval</strong> → orders &amp; payments group. Off: only approved payments are sent; waiting ones show as red counts under Payments. (Top-ups are always alerted: waiting, approved and rejected.)</span></label>
          </ActionForm>
          <ActionForm action={saveTelegramFeed} submitLabel="Save" size="sm" className="space-y-2">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="security" defaultChecked={feed.security} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><strong>Security events and alerts</strong> → security group</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="admin" defaultChecked={feed.admin} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><strong>Sensitive admin actions</strong> (blocking, staff / roles / bank / settings changes, deactivations, wallet corrections, exports, resets) → security group</span></label>
          </ActionForm>
        </Panel>
      )}
      </>)}

      {tab === "messages" && (<>
      <details className="mb-4 rounded-lg border bg-card p-4" data-testid="notif-export-clear">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><FileSpreadsheet className="size-4 text-primary" aria-hidden /> Export to Excel &amp; clear</summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <form method="get" action="/admin/notifications/export" className="space-y-2">
            <p className="text-sm font-medium">1. Export</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">From<input type="date" name="from" required defaultValue={monthAgo} max={today} className={`${fieldClass} mt-1 block`} /></label>
              <label className="text-sm">To<input type="date" name="to" required defaultValue={today} max={today} className={`${fieldClass} mt-1 block`} /></label>
              <Button type="submit"><Download /> Download .xlsx</Button>
            </div>
          </form>
          <ActionForm action={clearNotifications} submitLabel="Clear these notifications" variant="destructive" size="sm"
            confirm="Permanently remove the sent / failed notifications of these dates? (Allowed only after you downloaded their Excel export.)">
            <p className="text-sm font-medium">2. Clear (within 30 minutes of the export)</p>
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">From<input type="date" name="from" required defaultValue={monthAgo} max={today} className={`${fieldClass} mt-1 block`} /></label>
              <label className="text-sm">To<input type="date" name="to" required defaultValue={today} max={today} className={`${fieldClass} mt-1 block`} /></label>
            </div>
            <p className="text-xs text-muted-foreground">Any dates. Messages still waiting to be sent are kept. The clearing is recorded in the Activity log.</p>
          </ActionForm>
        </div>
      </details>
      <p className="mb-3 text-sm text-muted-foreground">
        {searching ? `${rows.length} message${rows.length === 1 ? "" : "s"} found` : `The latest ${rows.length} messages`}, newest first. Pick a category above. Failed messages are retried automatically (1, 2, 4… minutes); after the last attempt press <strong>Retry</strong>.
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
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2" data-testid="notif-search">
        <input type="hidden" name="tab" value="messages" />
        <input name="q" defaultValue={nq} placeholder="Order / job number, email, event or error" maxLength={100} aria-label="Search notifications" className={`${fieldClass} max-w-xs`} />
        <label className="text-sm">From<input type="date" name="from" defaultValue={nFrom} max={today} className={`${fieldClass} mt-1 block w-auto`} /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={nTo} max={today} className={`${fieldClass} mt-1 block w-auto`} /></label>
        <Button type="submit" variant="outline">Search</Button>
        {searching && <Link href="/admin/notifications?tab=messages" className="pb-2 text-sm text-primary underline">Clear search</Link>}
      </form>
      <SubTabs base="/admin/notifications" param="cat" level={2} keep={{ tab: "messages", q: nq || undefined, from: nFrom || undefined, to: nTo || undefined }} active={cat.key}
        tabs={cats.map((c) => ({ key: c.key, label: c.failed ? `${c.label} · ${c.failed} failed` : c.label, count: c.list.length }))} />
      <section data-category={cat.key} className="space-y-2">
        <p className="text-xs text-muted-foreground">{cat.hint}{cat.key !== "customers" && ` · ${({ security: "Security group", stock: stockConfigured ? "Stock group" : "Orders & payments group (until a stock bot is set)", receipts: "Receipts group", printing: "Printing group", orders: "Orders & payments group" } as Record<string, string>)[cat.group]}`}
          {cat.waiting > 0 && <Badge variant="info" className="ml-2">{cat.waiting} waiting</Badge>}</p>
        <Table scroll head={["#", "Event", "Via", "About", "Status", "Attempts", "Created", "Last error", ""]} empty="Nothing yet.">
          {cat.list.map((r) => (
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
      </section>
      </>)}
    </>
  );
}
