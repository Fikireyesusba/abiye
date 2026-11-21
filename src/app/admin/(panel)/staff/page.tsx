import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Field, Frame, PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { inviteStaff, removeStaff, resetStaffMfa, resetStaffPassword, updateStaff, updateStaffDetails } from "@/lib/admin/staff-actions";
import { maxBirthDate, personSummary } from "@/lib/age";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

const ROLES = [
  { key: "staff", label: "Staff", text: "Assigned orders, fulfillment updates, printing jobs" },
  { key: "manager", label: "Manager", text: "Products, inventory, all orders, payment verification, reports" },
  { key: "super_admin", label: "Super Admin", text: "Everything, incl. bank accounts, staff, settings, revenue" },
] as const;

export default async function StaffPage({ searchParams }: PageProps<"/admin/staff">) {
  const ctx = await requirePermission("staff.manage");
  const supabase = await createSupabaseServerClient();
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, phone, date_of_birth, sex, is_active, created_at, removed_at, role:admin_roles(key)").order("created_at");
  const current = (profiles ?? []).filter((p) => !p.removed_at);
  const removed = (profiles ?? []).filter((p) => p.removed_at);
  // Emails live in auth.users; read them server-side only, after the permission check above.
  const { data: users } = await getSupabaseAdmin().auth.admin.listUsers({ perPage: 1000 });
  const email = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  // Two-step login status per staff member (few accounts: one lookup each).
  const twoStep = new Map(await Promise.all(current.map(async (p) => {
    const { data } = await getSupabaseAdmin().auth.admin.mfa.listFactors({ userId: p.id });
    return [p.id, (data?.factors ?? []).some((f) => f.status === "verified")] as const;
  })));

  const TABS = [
    { key: "team", label: "Team", count: current.length },
    { key: "details", label: "Personal details" },
    { key: "add", label: "Add staff member" },
    { key: "roles", label: "Roles" },
    { key: "deleted", label: "Deleted staff", count: removed.length },
  ];
  const tab = pickTab(TABS, (await searchParams).tab);

  return (
    <>
      <PageHeader title="Staff" description="Who can sign in to this dashboard and what they can do." />
      <SubTabs base="/admin/staff" tabs={TABS} active={tab} />
      {tab === "team" && (
        <Table scroll head={["Name", "Role", "Access", "Password", "Two-step login", "Delete"]}>
          {current.map((p) => {
            const self = p.id === ctx.userId;
            const roleKey = (p.role as unknown as { key: string } | null)?.key ?? "staff";
            return (
              <tr key={p.id}>
                <Td><span className="font-medium">{p.full_name}</span>{self && <Badge variant="secondary" className="ml-2">you</Badge>}<span className="block text-xs text-muted-foreground">{email.get(p.id)}</span>{personSummary(p.sex, p.date_of_birth) && <span className="block text-xs text-muted-foreground">{personSummary(p.sex, p.date_of_birth)}</span>}</Td>
                <Td>
                  {self ? ROLES.find((r) => r.key === roleKey)?.label : (
                    <ActionForm action={updateStaff} hidden={{ userId: p.id, active: String(p.is_active) }} submitLabel="Save" size="sm" variant="outline" className="flex flex-wrap gap-2 space-y-0">
                      <select name="role" defaultValue={roleKey} className={`${fieldClass} h-8 w-auto`} aria-label={`Role for ${p.full_name}`}>
                        {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                    </ActionForm>
                  )}
                </Td>
                <Td>
                  {p.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Deactivated</Badge>}
                  {!self && (
                    <ActionForm action={updateStaff} hidden={{ userId: p.id, role: roleKey, active: String(!p.is_active) }}
                      submitLabel={p.is_active ? "Deactivate" : "Reactivate"} size="sm" variant="outline" className="mt-2 space-y-2"
                      confirm={p.is_active
                        ? `Deactivate ${p.full_name}? They lose access to the dashboard immediately. You can reactivate them later.`
                        : `Reactivate ${p.full_name}? They can sign in to the dashboard again with their current role.`} />
                  )}
                </Td>
                <Td>
                  {!self && (
                    <ActionForm action={resetStaffPassword} hidden={{ userId: p.id }} submitLabel="Reset" size="sm" variant="outline" keepSuccess
                      confirm={`Generate a new temporary password for ${p.full_name}?`} className="space-y-2" />
                  )}
                </Td>
                <Td>
                  {twoStep.get(p.id) ? <Badge variant="success">On</Badge> : <Badge variant="warning">Not set up</Badge>}
                  {!self && twoStep.get(p.id) && (
                    <ActionForm action={resetStaffMfa} hidden={{ userId: p.id }} submitLabel="Reset" size="sm" variant="outline" className="mt-2 space-y-2"
                      confirm={`Reset two-step login for ${p.full_name}? They will set up their authenticator again at the next sign-in (use this if they lost their phone).`} />
                  )}
                </Td>
                <Td>
                  {!self && (
                    <ActionForm action={removeStaff} hidden={{ userId: p.id }} submitLabel="Delete" size="sm" variant="destructive" keepSuccess className="space-y-2"
                      confirm={`Delete ${p.full_name} permanently? They can no longer sign in, their open orders and printing jobs are unassigned, and this cannot be undone. Their name stays in the activity history.`} />
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      {tab === "details" && (
        <Frame search="Search staff…" className="space-y-3 bg-transparent p-0">
          {current.map((p) => (
            <div key={p.id} data-row className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-sm font-medium">{p.full_name} <span className="font-normal text-muted-foreground">· {email.get(p.id)}{personSummary(p.sex, p.date_of_birth) && ` · ${personSummary(p.sex, p.date_of_birth)}`}</span></p>
              <ActionForm action={updateStaffDetails} hidden={{ userId: p.id }} submitLabel="Save" size="sm" variant="outline" className="grid items-end gap-2 space-y-0 sm:grid-cols-[1fr_10rem_10rem_8rem_auto]">
                <label className="text-xs">Full name<input name="fullName" required maxLength={120} defaultValue={p.full_name} className={`${fieldClass} mt-1 h-9`} /></label>
                <label className="text-xs">Phone<input name="phone" type="tel" maxLength={20} defaultValue={p.phone ?? ""} placeholder="0911 234 567" className={`${fieldClass} mt-1 h-9`} /></label>
                <label className="text-xs">Date of birth<input name="dateOfBirth" type="date" min="1900-01-01" max={maxBirthDate(14)} defaultValue={p.date_of_birth ?? ""} className={`${fieldClass} mt-1 h-9`} /></label>
                <label className="text-xs">Sex
                  <select name="sex" defaultValue={p.sex ?? ""} className={`${fieldClass} mt-1 h-9`}>
                    <option value="">—</option><option value="female">Female</option><option value="male">Male</option>
                  </select>
                </label>
              </ActionForm>
            </div>
          ))}
        </Frame>
      )}
      {tab === "deleted" && (
          <Panel title={`Deleted staff (${removed.length})`} scroll>
            {removed.length === 0 && <p className="text-sm text-muted-foreground">Nobody has been deleted.</p>}
            <ul className="space-y-1 text-sm text-muted-foreground">
              {removed.map((p) => <li key={p.id} className="break-words">{p.full_name} · {email.get(p.id)} · deleted {formatDateTime(p.removed_at!, "en")}</li>)}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Kept only so the history shows who did what. Their email address cannot be used for a new account.</p>
          </Panel>
      )}
      {tab === "add" && (
          <Panel title="Add staff member" className="max-w-xl">
            <ActionForm action={inviteStaff} submitLabel="Create account" keepSuccess resetOnSuccess>
              <Field label="Full name"><Input name="fullName" required maxLength={120} /></Field>
              <Field label="Email"><Input name="email" type="email" required maxLength={254} /></Field>
              <Field label="Role">
                <select name="role" defaultValue="staff" className={fieldClass}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
              </Field>
            </ActionForm>
          </Panel>
      )}
      {tab === "roles" && (
          <Panel title="Roles" className="max-w-2xl">
            <dl className="space-y-2 text-sm">{ROLES.map((r) => <div key={r.key}><dt className="font-medium">{r.label}</dt><dd className="text-muted-foreground">{r.text}</dd></div>)}</dl>
          </Panel>
      )}
    </>
  );
}
