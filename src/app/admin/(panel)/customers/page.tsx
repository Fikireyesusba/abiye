import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Table, Td, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requirePermission("customers.view");
  const q = (first((await searchParams).q) ?? "").trim().slice(0, 60);
  const supabase = await createSupabaseServerClient();
  const { data: accounts, error } = await supabase.rpc("admin_customer_accounts", { p_search: q || undefined, p_limit: 200 });
  if (error) throw new Error("Could not load customers");
  const unconfirmed = (accounts ?? []).filter((a) => !a.email_confirmed_at).length;

  return (
    <>
      <PageHeader title="Customers" description={`${accounts?.length ?? 0} registered account(s)${unconfirmed ? ` · ${unconfirmed} not yet confirmed` : ""}. Newest first.`} />
      <form method="get" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Email, name or phone" maxLength={60} className={`${fieldClass} max-w-xs`} aria-label="Search customers" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <Table head={["Customer", "Phone", "Email status", "Orders", "Joined"]} empty="No customers found.">
        {(accounts ?? []).map((a) => (
          <tr key={a.id} className="hover:bg-muted/40">
            <Td>
              <Link href={`/admin/customers/${a.id}`} className="font-medium text-primary hover:underline">{a.full_name || "—"}</Link>
              <span className="block text-xs break-all text-muted-foreground">{a.email}</span>
              {a.is_staff && <Badge variant="secondary" className="mt-1">staff</Badge>}
            </Td>
            <Td>{a.phone ? formatEthiopianPhone(a.phone) : "—"}</Td>
            <Td>{a.email_confirmed_at ? <Badge variant="success">Confirmed</Badge> : <Badge variant="warning">Not confirmed</Badge>}</Td>
            <Td className="tabular-nums">{a.order_count}{a.last_order_at && <span className="block text-xs text-muted-foreground">last {formatDateTime(a.last_order_at, "en")}</span>}</Td>
            <Td className="text-xs text-muted-foreground">{formatDateTime(a.created_at, "en")}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">“Not confirmed” means the customer has not clicked the link in the confirmation email yet, so they cannot sign in or order.</p>
    </>
  );
}
