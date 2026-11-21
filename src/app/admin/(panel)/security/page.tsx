import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { DatabaseUpdateNeeded, PageHeader, Panel, StatCard, SubTabs, Table, Td, fieldClass, isMissingDbFunction } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { blockEmail, clearReviewedList, markSecurityReviewed, unblockEmail } from "@/lib/admin/security-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime, zoneDayStartIso } from "@/lib/datetime";
import { emailConfigured } from "@/lib/email/dispatch";
import { pushConfigured } from "@/lib/push/dispatch";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { securityTelegramConfig, telegramConfig } from "@/lib/telegram/dispatch";
import { cn } from "@/lib/utils";
import { HIGH_RISK, isCustomerAlert, isEmailAlert } from "@/lib/admin/security-alerts";

export const metadata: Metadata = { title: "Security" };

const TABS = [
  { key: "alerts", label: "Active alerts" },
  { key: "overview", label: "Health & stats" },
  { key: "emails", label: "Suspicious emails" },
  { key: "customers", label: "Suspicious customers" },
  { key: "blocked", label: "Blocked" },
  { key: "logins", label: "Admin sign-ins" },
  { key: "events", label: "All events" },
] as const;
const KIND: Record<string, string> = {
  admin_login_failed: "Admin sign-in failed", admin_login_not_staff: "Non-staff tried admin sign-in", admin_mfa_failed: "Wrong two-step code",
  admin_login_success: "Admin signed in", customer_login_failed: "Customer sign-in failed", staff_customer_login: "Staff tried customer sign-in",
  login_blocked: "Blocked email tried to sign in", signup_blocked: "Blocked email tried to sign up", rate_limited: "Too many attempts (rate limited)",
};
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = (new Date().getTime() - Date.parse(iso)) / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};

export default async function SecurityPage({ searchParams }: PageProps<"/admin/security">) {
  const ctx = await requirePermission("audit.view");
  const canBlock = ctx.permissions.has("security.manage");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === first(sp.tab))?.key ?? "alerts";
  const supabase = await createSupabaseServerClient();
  const probe = await supabase.rpc("admin_system_health");
  if (isMissingDbFunction(probe.error)) return <DatabaseUpdateNeeded title="Security" migration="20261120000027_security_monitoring.sql" />;
  // Red counts on the tabs that hold active alerts.
  const [{ data: allEmails }, { data: allCustomers }] = await Promise.all([
    supabase.rpc("admin_suspicious_emails", { p_days: 7 }),
    supabase.rpc("admin_suspicious_customers", { p_days: 30 }),
  ]);
  const emailAlertCount = (allEmails ?? []).filter(isEmailAlert).length;
  const customerAlertCount = (allCustomers ?? []).filter(isCustomerAlert).length;
  const tabs = TABS.map((x) => ({
    ...x,
    ...(x.key === "alerts" ? { count: emailAlertCount + customerAlertCount, alert: true }
      : x.key === "emails" ? { count: emailAlertCount, alert: true }
      : x.key === "customers" ? { count: customerAlertCount, alert: true } : {}),
  }));

  const BlockForm = ({ email, compact }: { email?: string; compact?: boolean }) => (
    <ActionForm action={blockEmail} hidden={email ? { email } : undefined} submitLabel="Block" variant="destructive" size="sm"
      confirm={email ? `Block ${email}? It will not be able to sign up, sign in or order.` : "Block this email everywhere on the website?"}
      className={cn(compact ? "flex flex-wrap items-end gap-2 space-y-0" : "grid gap-2 sm:max-w-md")}>
      {!email && <input name="email" type="email" required placeholder="email@example.com" aria-label="Email to block" className={fieldClass} />}
      <input name="reason" required minLength={2} maxLength={500} placeholder="Reason" aria-label="Reason for blocking" className={cn(fieldClass, compact && "h-8 w-44")} />
    </ActionForm>
  );

  const ReviewForm = ({ type, subject }: { type: "email" | "customer"; subject: string }) => (
    <ActionForm action={markSecurityReviewed} hidden={{ type, subject }} submitLabel="Mark as reviewed" variant="outline" size="sm" className="mt-1 space-y-0" />
  );
  return (
    <>
      <PageHeader title="Security & health" description="Suspicious sign-ins (with the email that was used), risky customer behaviour, blocked emails and the health of the website." />
      <SubTabs base="/admin/security" tabs={tabs} active={tab} />
      {tab === "alerts" && <Alerts />}
      {tab === "overview" && <Overview />}
      {tab === "emails" && <><Emails /><Reviewed /></>}
      {tab === "customers" && <><Customers /><Reviewed /></>}
      {tab === "blocked" && <Blocked />}
      {tab === "logins" && <Events kind="admin_login_success" title="Successful admin sign-ins (after the two-step code)" />}
      {tab === "events" && <Events title="All security events (newest first)" />}
    </>
  );

  async function Alerts() {
    const [{ data: emails }, { data: customers }] = await Promise.all([
      supabase.rpc("admin_suspicious_emails", { p_days: 7 }),
      supabase.rpc("admin_suspicious_customers", { p_days: 30 }),
    ]);
    const emailAlerts = (emails ?? []).filter(isEmailAlert);
    const customerAlerts = (customers ?? []).filter(isCustomerAlert);
    const total = emailAlerts.length + customerAlerts.length;
    const Actions = ({ type, subject, email, staff }: { type: "email" | "customer"; subject: string; email: string; staff?: boolean }) =>
      canBlock ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {staff ? <Link href="/admin/staff" className="text-sm text-primary underline">Staff account — check under Staff (reset two-step login)</Link> : <BlockForm email={email} compact />}
          <ActionForm action={markSecurityReviewed} hidden={{ type, subject }} submitLabel="Mark as reviewed" variant="outline" size="sm" className="flex flex-wrap items-end gap-2 space-y-0">
            <input name="note" maxLength={500} placeholder="What did you check? (optional)" aria-label="Review note" className={cn(fieldClass, "h-8 w-56")} />
          </ActionForm>
        </div>
      ) : null;
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Alerts that need a decision. <strong>Block</strong> the email, or <strong>Mark as reviewed</strong> when you checked it and it is fine — either way the alert leaves this dashboard (and the red badge). It comes back only if something new happens.</p>
        {total === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed p-8 text-success"><CheckCircle2 className="size-5" aria-hidden /> No active alerts. Everything has been reviewed.</p>
        ) : (
          <>
            <ul className="max-h-[65vh] space-y-3 overflow-y-auto overscroll-contain" data-testid="active-alerts">
              {emailAlerts.map((e) => (
                <li key={`e:${e.email}`} className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" data-alert="email">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className="size-5 text-destructive" aria-hidden />
                    <span className="font-semibold break-all">{e.email}</span>
                    <Badge variant="destructive">high risk · score {e.score}</Badge>
                    {e.is_staff && <Badge variant="info">staff account</Badge>}
                    {!e.has_account && <Badge variant="secondary">no account</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">last seen {ago(e.last_seen)}</span>
                  </div>
                  <p className="mt-2 text-sm">
                    {[e.failed_admin > 0 && `${e.failed_admin} failed admin sign-in(s)`, e.failed_mfa > 0 && `${e.failed_mfa} wrong two-step code(s)`,
                      e.failed_customer > 0 && `${e.failed_customer} failed customer sign-in(s)`, e.blocked_attempts > 0 && `${e.blocked_attempts} blocked attempt(s)`,
                      e.rate_limited > 0 && `${e.rate_limited} rate-limited`, e.networks > 1 && `from ${e.networks} different networks`].filter(Boolean).join(" · ")}
                    {" "}<Link href={`/admin/security?tab=events&email=${encodeURIComponent(e.email)}`} className="text-primary underline">See events</Link>
                  </p>
                  <Actions type="email" subject={e.email} email={e.email} staff={e.is_staff} />
                </li>
              ))}
              {customerAlerts.map((c) => (
                <li key={`c:${c.user_id}`} className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4" data-alert="customer">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="size-5 text-amber-700" aria-hidden />
                    <Link href={`/admin/customers/${c.user_id}`} className="font-semibold text-primary underline break-all">{c.full_name || c.email}</Link>
                    <span className="text-xs text-muted-foreground break-all">{c.email}</span>
                    <Badge variant="warning">suspicious customer</Badge>
                  </div>
                  <ul className="mt-2 list-disc pl-5 text-sm">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  <Actions type="customer" subject={c.user_id} email={c.email} />
                </li>
              ))}
            </ul>
          </>
        )}
        <Reviewed />
      </div>
    );
  }

  async function Overview() {
    const h = probe.data as {
      outbox: Record<string, { pending: number; failed: number; dead_7d: number; oldest_pending: string | null }>;
      payments_pending: number; payments_oldest: string | null; topups_pending: number; topups_oldest: string | null;
      overdue_unexpired: number; paid_waiting_24h: number; out_of_stock: number;
      cron: Record<string, { last_run_at: string; ok: boolean }>; events_24h: Record<string, number>; blocked_emails: number;
    };
    const ev = (k: string) => h.events_24h[k] ?? 0;
    const adminFails = ev("admin_login_failed") + ev("admin_login_not_staff") + ev("admin_mfa_failed");
    // Only attempts not yet reviewed (and not from blocked emails) keep the card red.
    const { data: open } = await supabase.rpc("admin_suspicious_emails", { p_days: 1 });
    const openAdminFails = (open ?? []).filter((e) => !e.blocked).reduce((n, e) => n + Number(e.failed_admin) + Number(e.failed_mfa), 0);
    const jobs = [
      { name: "expire-orders", label: "Expire unpaid orders" },
      { name: "notifications", label: "Retry notifications" },
      { name: "storage-maintenance", label: "Storage clean-up" },
    ];
    const checks: { ok: boolean; text: string; href?: string }[] = [
      { ok: emailConfigured(), text: emailConfigured() ? "Customer emails configured" : "Customer emails not configured", href: "/admin/notifications" },
      { ok: pushConfigured(), text: pushConfigured() ? "Phone notifications configured" : "Phone notifications not configured", href: "/admin/notifications" },
      { ok: !!telegramConfig(), text: telegramConfig() ? "Orders & payments Telegram group connected" : "Orders & payments Telegram group not connected", href: "/admin/notifications" },
      { ok: !!securityTelegramConfig(), text: securityTelegramConfig() ? "Security Telegram group connected" : "Security Telegram group not connected", href: "/admin/notifications" },
      ...jobs.map((j) => {
        const r = h.cron[j.name];
        const fresh = r && Date.now() - Date.parse(r.last_run_at) < 36 * 3600000;
        return { ok: !!r && r.ok && !!fresh, text: `${j.label}: ${r ? `${r.ok ? "ran" : "FAILED"} ${ago(r.last_run_at)}` : "has not run yet"}` };
      }),
      { ok: h.overdue_unexpired === 0, text: h.overdue_unexpired ? `${h.overdue_unexpired} unpaid order(s) past the deadline not expired yet (stock still reserved)` : "Unpaid orders expire on time" },
      { ok: h.paid_waiting_24h === 0, text: h.paid_waiting_24h ? `${h.paid_waiting_24h} paid order(s) waiting more than 24 h to be processed` : "No paid orders waiting more than 24 h", href: "/admin/orders?status=confirmed" },
      ...Object.entries(h.outbox).map(([ch, o]) => ({ ok: o.failed === 0 && o.dead_7d === 0, text: `${({ email: "Customer emails", push: "Phone notifications", telegram: "Staff Telegram alerts" } as Record<string, string>)[ch] ?? ch}: ${o.pending} queued, ${o.failed} retrying, ${o.dead_7d} failed (7 days)`, href: "/admin/notifications" })),
    ];
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Failed admin sign-ins (24 h)" value={adminFails} hint={adminFails ? (openAdminFails ? `${openAdminFails} not reviewed` : "all reviewed") : undefined}
            tone={openAdminFails >= 5 ? "danger" : openAdminFails ? "warning" : undefined} href="/admin/security?tab=emails" />
          <StatCard label="Failed customer sign-ins (24 h)" value={ev("customer_login_failed")} href="/admin/security?tab=emails" />
          <StatCard label="Blocked attempts (24 h)" value={ev("login_blocked") + ev("signup_blocked")} hint={`${h.blocked_emails} email(s) blocked`} href="/admin/security?tab=blocked" />
          <StatCard label="Rate-limited (24 h)" value={ev("rate_limited")} tone={ev("rate_limited") ? "warning" : undefined} />
          <StatCard label="Payments to verify" value={h.payments_pending} hint={h.payments_oldest ? `oldest ${ago(h.payments_oldest)}` : undefined} href="/admin/payments" />
          <StatCard label="Top-ups to verify" value={h.topups_pending} hint={h.topups_oldest ? `oldest ${ago(h.topups_oldest)}` : undefined} href="/admin/wallet" />
          <StatCard label="Out of stock" value={h.out_of_stock} href="/admin/inventory?filter=low" tone={h.out_of_stock ? "warning" : undefined} />
          <StatCard label="Admin sign-ins (24 h)" value={ev("admin_login_success")} href="/admin/security?tab=logins" />
        </div>
        <Panel title="Site health">
          <ul className="space-y-2 text-sm">
            {checks.map((c) => (
              <li key={c.text} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                <span>{c.href ? <Link href={c.href} className="underline-offset-2 hover:underline">{c.text}</Link> : c.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Scheduled jobs run once a day on the current Vercel plan; a job not seen for 36 hours is flagged.</p>
        </Panel>
        {canBlock && <Panel title="Block an email"><BlockForm /></Panel>}
      </div>
    );
  }

  async function Emails() {
    const { data } = await supabase.rpc("admin_suspicious_emails", { p_days: 7 });
    return (
      <>
        <p className="mb-3 text-sm text-muted-foreground">Every email used in a failed or blocked sign-in in the last 7 days, riskiest first. Admin attempts weigh more; “networks” counts different internet connections. Checked one and it is fine? <strong>Mark as reviewed</strong> clears it (and the red badge) until something new happens.</p>
        <Table scroll head={["Email used", "Admin fails", "Code fails", "Customer fails", "Blocked tries", "Networks", "Last seen", "Action"]} empty="No failed sign-ins in the last 7 days.">
          {(data ?? []).map((r) => (
            <tr key={r.email} className={cn("align-top", isEmailAlert(r) && "bg-destructive/5")}>
              <Td className="max-w-[16rem] break-all">
                <span className="font-medium">{r.email}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {r.is_staff && <Badge variant="info">staff account</Badge>}
                  {!r.has_account && <Badge variant="secondary">no account</Badge>}
                  {isEmailAlert(r) && <Badge variant="destructive"><AlertTriangle className="size-3" /> {r.score >= HIGH_RISK ? "high risk" : "active alert"}</Badge>}
                  {r.blocked && <Badge variant="outline">blocked</Badge>}
                </span>
              </Td>
              <Td className="tabular-nums">{r.failed_admin}</Td>
              <Td className="tabular-nums">{r.failed_mfa}</Td>
              <Td className="tabular-nums">{r.failed_customer}</Td>
              <Td className="tabular-nums">{r.blocked_attempts}</Td>
              <Td className="tabular-nums">{r.networks}</Td>
              <Td className="text-xs whitespace-nowrap text-muted-foreground">{ago(r.last_seen)}</Td>
              <Td>
                {r.blocked ? <Link href="/admin/security?tab=blocked" className="text-xs text-primary underline">Blocked</Link>
                  : r.is_staff ? <Link href="/admin/staff" className="text-xs text-primary underline">Check under Staff</Link>
                  : canBlock ? <BlockForm email={r.email} compact /> : null}
                {canBlock && !r.blocked && <ReviewForm type="email" subject={r.email} />}
                <Link href={`/admin/security?tab=events&email=${encodeURIComponent(r.email)}`} className="mt-1 block text-xs text-primary underline">Events</Link>
              </Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }

  async function Reviewed() {
    const { data } = await supabase.rpc("admin_security_reviews", { p_limit: 50 });
    if (!data?.length) return null;
    return (
      <Panel title="Recently reviewed" className="mt-6" scroll
        actions={canBlock && <ActionForm action={clearReviewedList} hidden={{ all: "1" }} submitLabel="Clear list" variant="outline" size="sm" className="space-y-0"
          confirm="Clear the whole “Recently reviewed” list? The reviews stay in force (the alerts do not come back), and they remain in the Activity log." />}>
        <ul className="divide-y text-sm" data-testid="reviewed-list">
          {data.map((r) => (
            <li key={`${r.subject_type}:${r.subject}`} className="flex flex-wrap items-center gap-2 py-1.5 break-all">
              <span className="min-w-0 flex-1"><span className="font-medium">{r.subject}</span> <span className="text-muted-foreground">({r.subject_type}) · {formatDateTime(r.reviewed_at, "en")} by {r.reviewed_by_name ?? "—"}{r.note ? ` · ${r.note}` : ""}</span></span>
              {canBlock && <ActionForm action={clearReviewedList} hidden={{ type: r.subject_type, subject: r.subject }} submitLabel="Clear" variant="outline" size="sm" className="space-y-0" />}
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  async function Customers() {
    const { data } = await supabase.rpc("admin_suspicious_customers", { p_days: 30 });
    return (
      <>
        <p className="mb-3 text-sm text-muted-foreground">Customers whose behaviour in the last 30 days needs a look: unpaid orders that hold stock, rejected receipts, receipts or bank references also used by someone else, many failed sign-ins, baskets left together with unpaid orders. <strong>Mark as reviewed</strong> clears a customer until new behaviour appears.</p>
        <Table scroll head={["Customer", "Why", "Unpaid (expired / cancelled)", "Rejected receipts", "Reused receipts", "Failed sign-ins", "Action"]} empty="No suspicious customers in the last 30 days.">
          {(data ?? []).map((r) => (
            <tr key={r.user_id} className="align-top">
              <Td className="max-w-[14rem] break-all">
                <Link href={`/admin/customers/${r.user_id}`} className="font-medium text-primary underline underline-offset-2">{r.full_name || r.email}</Link>
                <span className="block text-xs text-muted-foreground">{r.email}</span>
                <span className="mt-1 flex gap-1">{r.deactivated && <Badge variant="destructive">deactivated</Badge>}{r.blocked && <Badge variant="outline">blocked</Badge>}</span>
              </Td>
              <Td className="text-xs"><ul className="list-disc pl-4">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul></Td>
              <Td className="tabular-nums">{r.expired_orders} / {r.cancelled_unpaid}</Td>
              <Td className="tabular-nums">{r.rejected_payments + r.rejected_topups}</Td>
              <Td className="tabular-nums">{r.reused_receipts}</Td>
              <Td className="tabular-nums">{r.failed_logins}</Td>
              <Td>{!r.blocked && canBlock && <BlockForm email={r.email} compact />}{canBlock && <ReviewForm type="customer" subject={r.user_id} />}</Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }

  async function Blocked() {
    const { data } = await supabase.rpc("admin_blocked_emails");
    return (
      <div className="space-y-6">
        {canBlock && <Panel title="Block an email"><BlockForm /></Panel>}
        <Table scroll head={["Email", "Reason", "Blocked by", "When", ""]} empty="No blocked emails.">
          {(data ?? []).map((r) => (
            <tr key={r.email} className="align-top">
              <Td className="break-all"><span className="flex items-center gap-1 font-medium"><ShieldAlert className="size-4 text-destructive" aria-hidden /> {r.email}</span>{r.has_account && <span className="text-xs text-muted-foreground">has an account (deactivated)</span>}</Td>
              <Td className="text-sm">{r.reason}</Td>
              <Td className="text-sm">{r.blocked_by ?? "—"}</Td>
              <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at, "en")}</Td>
              <Td>{canBlock && <ActionForm action={unblockEmail} hidden={{ email: r.email }} submitLabel="Unblock" variant="outline" size="sm" confirm={`Unblock ${r.email}?`} className="space-y-0" />}</Td>
            </tr>
          ))}
        </Table>
      </div>
    );
  }

  async function Events({ kind, title }: { kind?: string; title: string }) {
    const email = (first(sp.email) ?? "").trim().toLowerCase().slice(0, 254);
    const q = (first(sp.q) ?? "").trim().slice(0, 100);
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    const fromDay = DAY.test(first(sp.from) ?? "") ? first(sp.from)! : "";
    const toDay = DAY.test(first(sp.to) ?? "") ? first(sp.to)! : "";
    const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const { data } = await supabase.rpc("admin_security_events", {
      p_kind: kind, p_email: email || undefined, p_limit: 1000, p_search: q || undefined,
      p_from: fromDay ? zoneDayStartIso(fromDay) : undefined, p_to: toDay ? zoneDayStartIso(nextDay(toDay)) : undefined,
    });
    return (
      <>
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2" data-testid="events-search">
          <input type="hidden" name="tab" value={tab} />
          {email && <input type="hidden" name="email" value={email} />}
          <input name="q" defaultValue={q} placeholder="Email, event, device or network" maxLength={100} aria-label="Search events" className={`${fieldClass} max-w-xs`} />
          <label className="text-sm">From<input type="date" name="from" defaultValue={fromDay} className={`${fieldClass} mt-1 block w-auto`} /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={toDay} className={`${fieldClass} mt-1 block w-auto`} /></label>
          <button type="submit" className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Search</button>
          {(q || fromDay || toDay) && <Link href={`/admin/security?tab=${tab}`} className="pb-2 text-sm text-primary underline">Clear search</Link>}
        </form>
        <p className="mb-3 text-sm text-muted-foreground">{(data ?? []).length} event{(data ?? []).length === 1 ? "" : "s"}{(q || fromDay || toDay) ? " found" : " (newest first)"}. {title}{email && <> — for <strong>{email}</strong> · <Link href={`/admin/security?tab=${tab}`} className="text-primary underline">show all</Link></>}. Network = short code of the internet connection (same code = same connection).</p>
        <Table scroll head={["When", "What", "Email", "Account", "Network", "Device"]} empty="No events.">
          {(data ?? []).map((e) => (
            <tr key={e.id} className="align-top">
              <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at, "en")}</Td>
              <Td className={cn("text-sm", e.kind !== "admin_login_success" && "text-destructive")}>{KIND[e.kind] ?? e.kind}</Td>
              <Td className="max-w-[14rem] text-sm break-all">{e.email ?? "—"}</Td>
              <Td className="text-sm">{e.user_name ?? "—"}</Td>
              <Td className="font-mono text-xs">{e.ip_hash ?? "—"}</Td>
              <Td className="max-w-[16rem] text-xs break-words text-muted-foreground">{e.user_agent ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }
}
