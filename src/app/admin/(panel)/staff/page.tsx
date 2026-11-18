import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { inviteStaff, resetStaffPassword, updateStaff } from "@/lib/admin/staff-actions";
import { requirePermission } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

const ROLES = [
  { key: "staff", label: "Staff", text: "Assigned orders, fulfillment updates, printing jobs" },
  { key: "manager", label: "Manager", text: "Products, inventory, all orders, payment verification, reports" },
  { key: "super_admin", label: "Super Admin", text: "Everything, incl. bank accounts, staff, settings, revenue" },
] as const;

export default async function StaffPage() {
  const ctx = await requirePermission("staff.manage");
  const supabase = await createSupabaseServerClient();
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, is_active, created_at, role:admin_roles(key)").order("created_at");
  // Emails live in auth.users; read them server-side only, after the permission check above.
  const { data: users } = await getSupabaseAdmin().auth.admin.listUsers({ perPage: 1000 });
  const email = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  return (
    <>
      <PageHeader title="Staff" description="Who can sign in to this dashboard and what they can do." />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <Table head={["Name", "Role", "Status", "Change", "Password"]}>
          {(profiles ?? []).map((p) => {
            const self = p.id === ctx.userId;
            const roleKey = (p.role as unknown as { key: string } | null)?.key ?? "staff";
            return (
              <tr key={p.id}>
                <Td><span className="font-medium">{p.full_name}</span>{self && <Badge variant="secondary" className="ml-2">you</Badge>}<span className="block text-xs text-muted-foreground">{email.get(p.id)}</span></Td>
                <Td>{ROLES.find((r) => r.key === roleKey)?.label}</Td>
                <Td>{p.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">No access</Badge>}</Td>
                <Td>
                  {self ? <span className="text-xs text-muted-foreground">—</span> : (
                    <ActionForm action={updateStaff} hidden={{ userId: p.id }} submitLabel="Save" size="sm" variant="outline" className="flex flex-wrap gap-2 space-y-0">
                      <select name="role" defaultValue={roleKey} className={`${fieldClass} h-8 w-auto`} aria-label={`Role for ${p.full_name}`}>
                        {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                      <select name="active" defaultValue={String(p.is_active)} className={`${fieldClass} h-8 w-auto`} aria-label="Access">
                        <option value="true">Active</option><option value="false">No access</option>
                      </select>
                    </ActionForm>
                  )}
                </Td>
                <Td>
                  {!self && (
                    <ActionForm action={resetStaffPassword} hidden={{ userId: p.id }} submitLabel="Reset" size="sm" variant="outline" keepSuccess
                      confirm={`Generate a new temporary password for ${p.full_name}?`} className="space-y-2" />
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        <div className="space-y-6">
          <Panel title="Add staff member">
            <ActionForm action={inviteStaff} submitLabel="Create account" keepSuccess resetOnSuccess>
              <Field label="Full name"><Input name="fullName" required maxLength={120} /></Field>
              <Field label="Email"><Input name="email" type="email" required maxLength={254} /></Field>
              <Field label="Role">
                <select name="role" defaultValue="staff" className={fieldClass}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
              </Field>
            </ActionForm>
          </Panel>
          <Panel title="Roles">
            <dl className="space-y-2 text-sm">{ROLES.map((r) => <div key={r.key}><dt className="font-medium">{r.label}</dt><dd className="text-muted-foreground">{r.text}</dd></div>)}</dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
