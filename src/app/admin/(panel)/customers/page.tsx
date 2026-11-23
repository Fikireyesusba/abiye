import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inviteCustomer } from "@/lib/admin/customer-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const ctx = await requirePermission("customers.view");
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 60);
  const supabase = await createSupabaseServerClient();
  const { data: accounts, error } = await supabase.rpc("admin_customer_accounts", { p_search: q || undefined, p_limit: 200 });
  if (error) throw new Error("Could not load customers");
  const unconfirmed = (accounts ?? []).filter((a) => !a.email_confirmed_at).length;
  const deactivated = (accounts ?? []).filter((a) => a.deactivated_at).length;

  return (
    <>
      <PageHeader title="Customers" description={`${accounts?.length ?? 0} registered account(s)${unconfirmed ? ` · ${unconfirmed} not yet confirmed` : ""}${deactivated ? ` · ${deactivated} deactivated` : ""}. Newest first. Staff accounts are managed under Staff.`} />
      {first(sp.deleted) && <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">The account was deleted. The deletion is recorded in the activity log.</p>}
      {ctx.permissions.has("customers.manage") && (
        <details className="mb-4 rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">Invite a customer</summary>
          <ActionForm action={inviteCustomer} submitLabel="Send invitation" resetOnSuccess className="mt-3 grid gap-3 sm:max-w-md">
            <Field label="Email" htmlFor="invite-email"><input id="invite-email" name="email" type="email" required maxLength={254} autoComplete="off" className={fieldClass} /></Field>
            <Field label="Name (optional)" htmlFor="invite-name"><input id="invite-name" name="fullName" maxLength={120} autoComplete="off" className={fieldClass} /></Field>
            <p className="text-xs text-muted-foreground">They receive an email with a link to set their password. Then they can sign in and order.</p>
          </ActionForm>
        </details>
      )}
      <form method="get" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Email, name, phone or User ID" maxLength={60} className={`${fieldClass} max-w-xs`} aria-label="Search customers" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <Table scroll head={["User ID", "Status", "Orders", "Joined"]} empty="No customers found.">
        {(accounts ?? []).map((a) => (
          <tr key={a.id} className="hover:bg-muted/40">
            <Td>
              <Link href={`/admin/customers/${a.id}`} className="font-mono font-medium text-primary hover:underline" data-testid="member-id">{a.member_id}</Link>
            </Td>
            <Td>{a.deactivated_at ? <Badge variant="destructive">Deactivated</Badge> : a.email_confirmed_at ? <Badge variant="success">Confirmed</Badge> : <Badge variant="warning">Not confirmed</Badge>}</Td>
            <Td className="tabular-nums">{a.order_count}{a.last_order_at && <span className="block text-xs text-muted-foreground">last {formatDateTime(a.last_order_at, "en")}</span>}</Td>
            <Td className="text-xs text-muted-foreground">{formatDateTime(a.created_at, "en")}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">“Not confirmed” means the customer has not clicked the link in the confirmation email yet, so they cannot sign in or order.</p>
    </>
  );
}
