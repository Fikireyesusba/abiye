import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Table, Td, fieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guards";
import { first, sanitizeSearchTerm } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone, normalizeEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requirePermission("customers.view");
  const raw = first((await searchParams).q) ?? "";
  const phone = normalizeEthiopianPhone(raw);
  const name = sanitizeSearchTerm(raw);
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("customers").select("id, full_name, phone, order_count, last_order_at, created_at").order("last_order_at", { ascending: false, nullsFirst: false }).limit(100);
  if (phone) query = query.eq("phone", phone);
  else if (name) query = query.ilike("full_name", `%${name}%`);
  const { data: customers } = await query;
  return (
    <>
      <PageHeader title="Customers" description="Guest customers, identified by phone number." />
      <form method="get" className="mb-4 flex gap-2">
        <input name="q" defaultValue={raw} placeholder="Name or phone" maxLength={40} className={`${fieldClass} max-w-xs`} aria-label="Search customers" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <Table head={["Customer", "Phone", "Orders", "Last order"]} empty="No customers found.">
        {(customers ?? []).map((c) => (
          <tr key={c.id} className="hover:bg-muted/40">
            <Td><Link href={`/admin/customers/${c.id}`} className="font-medium text-primary hover:underline">{c.full_name}</Link></Td>
            <Td>{formatEthiopianPhone(c.phone)}</Td>
            <Td className="tabular-nums">{c.order_count}</Td>
            <Td className="text-xs text-muted-foreground">{c.last_order_at ? formatDateTime(c.last_order_at, "en") : "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
