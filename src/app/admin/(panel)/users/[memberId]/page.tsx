import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SignInPanel } from "@/components/admin/sign-in-panel";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { personSummary } from "@/lib/age";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "User" };

/**
 * Opened from any User ID in the admin. A customer goes to their customer page (orders, balance…);
 * a staff member is shown here (details, sign-in, devices).
 */
export default async function UserPage({ params }: PageProps<"/admin/users/[memberId]">) {
  const ctx = await requirePermission("customers.view", "staff.manage", "security.manage", "support.view");
  const { memberId } = await params;
  if (!/^[1-9][0-9]{5}$/.test(memberId)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: found } = await supabase.rpc("admin_find_user", { p_member_id: memberId });
  const who = found?.[0];
  if (!who) notFound();
  if (!who.is_staff && ctx.permissions.has("customers.view")) redirect(`/admin/customers/${who.user_id}`);
  const canDetails = who.is_staff ? ctx.permissions.has("staff.manage") || ctx.permissions.has("security.manage") : ctx.permissions.has("security.manage");

  // Details only after the permission checks above.
  const [{ data: auth }, { data: profile }, { data: account }] = canDetails
    ? await Promise.all([
        getSupabaseAdmin().auth.admin.getUserById(who.user_id),
        getSupabaseAdmin().from("profiles").select("full_name, phone, date_of_birth, sex, is_active, removed_at, created_at, role:admin_roles(name)").eq("id", who.user_id).maybeSingle(),
        getSupabaseAdmin().from("customer_accounts").select("full_name, phone, date_of_birth, sex, deactivated_at").eq("id", who.user_id).maybeSingle(),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const user = auth?.user;
  const name = profile?.full_name ?? account?.full_name ?? null;
  const phone = profile?.phone ?? account?.phone ?? null;
  const summary = personSummary(profile?.sex ?? account?.sex ?? null, profile?.date_of_birth ?? account?.date_of_birth ?? null);
  const role = (profile?.role as { name?: string } | null)?.name;

  return (
    <>
      <Link href="/admin/users" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Signed-in users</Link>
      <PageHeader title={`User ID ${memberId}`} description={who.is_staff ? "Staff member" : "Customer"}
        actions={<div className="flex gap-2">{role && <Badge variant="secondary">{role}</Badge>}{profile?.removed_at && <Badge variant="destructive">Deleted</Badge>}{profile && !profile.is_active && !profile.removed_at && <Badge variant="warning">Deactivated</Badge>}{account?.deactivated_at && <Badge variant="destructive">Deactivated</Badge>}</div>} />
      {!canDetails ? (
        <p className="text-sm text-muted-foreground">You do not have permission to see this person&apos;s details.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Personal details">
            <dl className="space-y-1 text-sm" data-testid="user-details">
              <div>Name: <strong>{name ?? "—"}</strong></div>
              <div className="break-all">Email: {user?.email ?? "—"}</div>
              <div>Phone: {phone ? formatEthiopianPhone(phone) : "—"}</div>
              {summary && <div>{summary}</div>}
              <div>Account created: {user?.created_at ? formatDateTime(user.created_at, "en") : "—"}</div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {ctx.permissions.has("audit.view") && <Link href={`/admin/activity?q=${memberId}`} className="text-primary hover:underline">Their activity</Link>}
              {who.is_staff && ctx.permissions.has("staff.manage") && <Link href="/admin/staff" className="text-primary hover:underline">Manage under Staff</Link>}
            </div>
          </Panel>
          <SignInPanel ctx={ctx} userId={who.user_id} memberId={memberId} lastSignIn={user?.last_sign_in_at ?? null} />
        </div>
      )}
    </>
  );
}
