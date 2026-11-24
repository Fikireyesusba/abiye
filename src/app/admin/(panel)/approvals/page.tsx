import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { approveCustomer, rejectCustomer } from "@/lib/admin/approval-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Account approvals" };

/** New customer accounts waiting for a decision: approve, or reject with a reason (email, delete, block). */
export default async function ApprovalsPage() {
  await requirePermission("customers.approve");
  const { data } = await (await createSupabaseServerClient()).rpc("admin_pending_customers");
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Account approvals" description="New customer accounts are “Under verification” until approved: they can browse and contact Support, but cannot order. Rejecting emails the customer, deletes the account and blocks the email." />
      {rows.length === 0 && <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">No accounts waiting for approval.</p>}
      <ul className="space-y-4">
        {rows.map((c) => (
          <li key={c.id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="pending-account">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold">{c.member_id ?? "—"}</span>
              <Badge variant="warning">Under verification</Badge>
              {!c.email_confirmed && <Badge variant="secondary">email not confirmed yet</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">Signed up {formatDateTime(c.created_at, "en")}</span>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-muted-foreground">Name: </dt><dd className="inline font-medium">{c.full_name || "—"}</dd></div>
              <div><dt className="inline text-muted-foreground">Email: </dt><dd className="inline break-all">{c.email}</dd></div>
              <div><dt className="inline text-muted-foreground">Phone: </dt><dd className="inline">{c.phone ? formatEthiopianPhone(c.phone) : "—"}</dd></div>
              <div><dt className="inline text-muted-foreground">Date of birth: </dt><dd className="inline">{c.date_of_birth ?? "—"}</dd></div>
              <div><dt className="inline text-muted-foreground">Sex: </dt><dd className="inline capitalize">{c.sex ?? "—"}</dd></div>
              <div><dt className="inline text-muted-foreground">Address: </dt><dd className="inline">{c.default_address || "—"}</dd></div>
              <div><dt className="inline text-muted-foreground">Last sign-in: </dt><dd className="inline">{c.last_sign_in_at ? formatDateTime(c.last_sign_in_at, "en") : "—"}</dd></div>
            </dl>
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
              <ActionForm action={approveCustomer} hidden={{ userId: c.id }} submitLabel="Approve" className="[&_button]:w-full" />
              <ActionForm action={rejectCustomer} hidden={{ userId: c.id }} submitLabel="Reject, delete & block" variant="destructive"
                confirm={`Reject ${c.member_id ?? "this account"}? The customer is emailed, the account is deleted and ${c.email} is blocked.`} className="space-y-2 [&_button]:w-full">
                <input name="reason" required minLength={5} maxLength={500} placeholder="Reason (sent to the customer)" aria-label={`Reason for rejecting ${c.member_id}`} className={fieldClass} />
              </ActionForm>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
