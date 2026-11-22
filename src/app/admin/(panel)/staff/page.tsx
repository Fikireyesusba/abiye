import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Field, Frame, PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { UserIdLink } from "@/components/admin/user-id";
import { Input } from "@/components/ui/input";
import { deleteRole, inviteStaff, removeStaff, resetStaffMfa, resetStaffPassword, saveRole, setMemberPermissions, updateStaff, updateStaffDetails } from "@/lib/admin/staff-actions";
import { maxBirthDate, personSummary } from "@/lib/age";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

/** Permission areas, for grouping the check boxes. */
const AREA: Record<string, string> = {
  dashboard: "Dashboard", orders: "Orders", payments: "Payments", wallet: "Wallet", printing: "Printing", products: "Products",
  categories: "Products", inventory: "Products", customers: "Customers", promotions: "Promotions", reviews: "Reviews",
  analytics: "Reports", reports: "Reports", settings: "Settings", bank_accounts: "Settings", staff: "Staff", audit: "Activity & security",
  security: "Activity & security", data: "Export & reset", support: "Support",
};

export default async function StaffPage({ searchParams }: PageProps<"/admin/staff">) {
  const ctx = await requirePermission("staff.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: roleRows }, { data: rolePerms }, { data: allPerms }, { data: personal }] = await Promise.all([
    supabase.from("admin_roles").select("id, key, name, description, is_builtin").order("id"),
    supabase.from("role_permissions").select("role_id, permission_key"),
    supabase.from("admin_permissions").select("key, description").order("key"),
    supabase.from("profile_permissions").select("profile_id, permission_key"),
  ]);
  const ROLES = (roleRows ?? []).map((r) => ({ id: r.id, key: r.key, label: r.name, text: r.description ?? "", builtin: r.is_builtin,
    perms: new Set((rolePerms ?? []).filter((x) => x.role_id === r.id).map((x) => x.permission_key)) }));
  const perms = (allPerms ?? []).filter((x) => x.key !== "staff.manage");
  const areas = [...new Set(perms.map((x) => AREA[x.key.split(".")[0]] ?? "Other"))];
  const permBoxes = (checked: (k: string) => boolean, locked?: (k: string) => boolean) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {areas.map((a) => (
        <fieldset key={a} className="rounded-md border p-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">{a}</legend>
          {perms.filter((x) => (AREA[x.key.split(".")[0]] ?? "Other") === a).map((x) => (
            <label key={x.key} className="flex items-start gap-2 py-0.5 text-xs">
              <input type="checkbox" name="perm" value={x.key} defaultChecked={checked(x.key)} disabled={locked?.(x.key)} className="mt-0.5 size-3.5 accent-[var(--primary)]" />
              <span>{x.description}{locked?.(x.key) && <span className="text-muted-foreground"> (from the set)</span>}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, phone, date_of_birth, sex, is_active, created_at, removed_at, role:admin_roles(key)").order("created_at");
  const current = (profiles ?? []).filter((p) => !p.removed_at);
  const removed = (profiles ?? []).filter((p) => p.removed_at);
  // Emails live in auth.users; read them server-side only, after the permission check above.
  const { data: users } = await getSupabaseAdmin().auth.admin.listUsers({ perPage: 1000 });
  const email = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const { data: ids } = await getSupabaseAdmin().from("customer_accounts").select("id, member_id").in("id", (profiles ?? []).map((p) => p.id));
  const memberId = new Map((ids ?? []).map((r) => [r.id, r.member_id]));
  // Two-step login status per staff member (few accounts: one lookup each).
  const twoStep = new Map(await Promise.all(current.map(async (p) => {
    const { data } = await getSupabaseAdmin().auth.admin.mfa.listFactors({ userId: p.id });
    return [p.id, (data?.factors ?? []).some((f) => f.status === "verified")] as const;
  })));

  const TABS = [
    { key: "team", label: "Team", count: current.length },
    { key: "details", label: "Personal details" },
    { key: "add", label: "Add staff member" },
    { key: "roles", label: "Permission sets", count: ROLES.length },
    { key: "personal", label: "Personal permissions" },
    { key: "deleted", label: "Deleted staff", count: removed.length },
  ];
  const tab = pickTab(TABS, (await searchParams).tab);

  return (
    <>
      <PageHeader title="Staff" description="Who can sign in to this dashboard and what they can do." />
      <SubTabs base="/admin/staff" tabs={TABS} active={tab} />
      {tab === "team" && (
        <Table scroll head={["User", "Role", "Access", "Password", "Two-step login", "Delete"]}>
          {current.map((p) => {
            const self = p.id === ctx.userId;
            const roleKey = (p.role as unknown as { key: string } | null)?.key ?? "staff";
            return (
              <tr key={p.id}>
                <Td><UserIdLink id={memberId.get(p.id)} />{self && <Badge variant="secondary" className="ml-2">you</Badge>}</Td>
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
              <p className="mb-2 text-sm font-medium">{p.full_name} <span className="font-normal text-muted-foreground">· User ID {memberId.get(p.id) ?? "—"} · {email.get(p.id)}{personSummary(p.sex, p.date_of_birth) && ` · ${personSummary(p.sex, p.date_of_birth)}`}</span></p>
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
              {removed.map((p) => <li key={p.id} className="break-words"><UserIdLink id={memberId.get(p.id)} /> · deleted {formatDateTime(p.removed_at!, "en")}</li>)}
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
        <div className="space-y-4" data-testid="permission-sets">
          <p className="text-sm text-muted-foreground">A permission set decides what its members can see and do. Edit Manager or Staff, or create your own (e.g. “Cashier”), then assign it under Team. Changes apply immediately. Only a Super Admin can manage staff.</p>
          {ROLES.map((r) => {
            const members = current.filter((p) => (p.role as unknown as { key: string } | null)?.key === r.key).length;
            return (
              <details key={r.id} className="rounded-xl border bg-card p-4" data-role={r.key}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-medium">{r.label}</span>
                  {r.builtin && <Badge variant="secondary">built-in</Badge>}
                  <span className="text-xs text-muted-foreground">{r.key === "super_admin" ? "every permission" : `${r.perms.size} permission${r.perms.size === 1 ? "" : "s"}`} · {members} member{members === 1 ? "" : "s"}</span>
                  {r.text && <span className="w-full text-xs text-muted-foreground">{r.text}</span>}
                </summary>
                {r.key === "super_admin" ? <p className="mt-3 text-sm text-muted-foreground">Super Admin always has every permission and cannot be narrowed.</p> : (
                  <div className="mt-3 space-y-3">
                    <ActionForm action={saveRole} hidden={{ roleId: String(r.id) }} submitLabel="Save permission set" size="sm" className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm">Name<input name="name" required minLength={2} maxLength={60} defaultValue={r.label} className={`${fieldClass} mt-1`} /></label>
                        <label className="text-sm">Description<input name="description" maxLength={300} defaultValue={r.text} className={`${fieldClass} mt-1`} /></label>
                      </div>
                      {permBoxes((k) => r.perms.has(k))}
                    </ActionForm>
                    {!r.builtin && members === 0 && (
                      <ActionForm action={deleteRole} hidden={{ roleId: String(r.id) }} submitLabel="Delete this set" variant="outline" size="sm" confirm={`Delete the permission set “${r.label}”?`} />
                    )}
                  </div>
                )}
              </details>
            );
          })}
          <Panel title="New permission set">
            <ActionForm action={saveRole} hidden={{ roleId: "" }} submitLabel="Create permission set" resetOnSuccess className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Name<input name="name" required minLength={2} maxLength={60} placeholder="e.g. Cashier" className={`${fieldClass} mt-1`} /></label>
                <label className="text-sm">Description<input name="description" maxLength={300} placeholder="What this set is for" className={`${fieldClass} mt-1`} /></label>
              </div>
              {permBoxes((k) => k === "dashboard.view")}
            </ActionForm>
          </Panel>
        </div>
      )}
      {tab === "personal" && (
        <Frame search="Search staff…" className="space-y-3 bg-transparent p-0">
          <p className="text-sm text-muted-foreground">Give one person something extra on top of their permission set (e.g. let one staff member verify payments). Ticked and greyed out = already in their set.</p>
          {current.filter((p) => p.id !== ctx.userId && (p.role as unknown as { key: string } | null)?.key !== "super_admin").map((p) => {
            const set = ROLES.find((r) => r.key === (p.role as unknown as { key: string } | null)?.key);
            const mine = new Set((personal ?? []).filter((x) => x.profile_id === p.id).map((x) => x.permission_key));
            return (
              <details key={p.id} data-row className="rounded-xl border bg-card p-4" data-member={email.get(p.id)}>
                <summary className="cursor-pointer text-sm"><span className="font-mono font-medium">User ID {memberId.get(p.id) ?? "—"}</span> <span className="text-muted-foreground">· {set?.label}{mine.size ? ` · +${mine.size} personal` : ""}</span></summary>
                <ActionForm action={setMemberPermissions} hidden={{ userId: p.id }} submitLabel="Save personal permissions" size="sm" className="mt-3 space-y-3">
                  {permBoxes((k) => mine.has(k) || !!set?.perms.has(k), (k) => !!set?.perms.has(k))}
                </ActionForm>
              </details>
            );
          })}
        </Frame>
      )}
    </>
  );
}
