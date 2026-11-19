import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, Table, Td } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { retryNotification, sendTestNotification } from "@/lib/admin/notification-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { telegramConfig } from "@/lib/telegram/dispatch";
import { emailConfigured } from "@/lib/email/dispatch";
import { pushConfigured } from "@/lib/push/dispatch";
import { getSiteSettings } from "@/lib/catalog/settings";
import { VapidKeyGenerator } from "@/components/admin/vapid-keys";

export const metadata: Metadata = { title: "Notifications" };

const LABEL: Record<string, string> = {
  new_order: "New order", payment_resubmitted: "Payment resubmitted", printing_request: "Printing request",
  payment_verified: "Payment verified", payment_rejected: "Payment rejected", order_cancelled: "Order cancelled", test_message: "Test",
};
const TONE = { sent: "success", pending: "secondary", processing: "info", failed: "warning", dead: "destructive" } as const;

export default async function NotificationsPage() {
  await requirePermission("settings.manage");
  const configured = !!telegramConfig();
  const emailOn = emailConfigured();
  const pushOn = pushConfigured();
  const settings = await getSiteSettings();
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase.rpc("admin_notifications", { p_limit: 100 });
  const problems = (rows ?? []).filter((r) => r.status === "failed" || r.status === "dead").length;

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
          {!pushOn && <VapidKeyGenerator suggestedSubject={`mailto:${settings.contact.email || "orders@example.com"}`} />}
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
