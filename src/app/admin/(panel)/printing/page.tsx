import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, SubTabs, Table, Td } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Printing" };

// Jobs the customer has not paid for yet (submitted / awaiting payment) are not shown — only work for the shop.
const TABS = [
  // A printing order exists once its payment is accepted; payments waiting for approval are under Payments.
  { k: "todo", l: "To print / hand over", s: ["printing", "ready"] },
  { k: "quote", l: "Needs a price", s: ["awaiting_quote"] },
  { k: "done", l: "Completed / cancelled", s: ["completed", "cancelled"] },
] as const;

export default async function PrintingJobsPage({ searchParams }: PageProps<"/admin/printing">) {
  const ctx = await requirePermission("printing.view");
  const requested = first((await searchParams).tab);
  const tab = TABS.find((x) => x.k === requested) ?? TABS[0];
  const supabase = await createSupabaseServerClient();
  const { data: jobs } = await supabase
    .from("printing_jobs")
    .select("id, job_number, customer_name, customer_phone, color_mode, paper_size, sides, copies, page_count, total_etb, status, fulfillment_method, created_at, files:printing_files(id)")
    .in("status", [...tab.s])
    .order("created_at", { ascending: tab.k !== "done" })
    .limit(100);

  return (
    <>
      <PageHeader title="Printing jobs" description="Quote documents that could not be counted, print paid jobs, and mark them ready."
        actions={ctx.permissions.has("printing.pricing") && <Button variant="outline" asChild><Link href="/admin/printing/prices">Price list</Link></Button>} />
      <SubTabs base="/admin/printing" tabs={TABS.map((x) => ({ key: x.k, label: x.l }))} active={tab.k} />
      <Table scroll head={["Job", "Customer", "Options", "Pages", "Price", "Status", "Received"]} empty="No printing jobs here.">
        {(jobs ?? []).map((j) => (
          <tr key={j.id} className="hover:bg-muted/40">
            <Td><Link href={`/admin/printing/${j.id}`} className="font-medium text-primary hover:underline">{j.job_number}</Link></Td>
            <Td>{j.customer_name}<span className="block text-xs text-muted-foreground">{formatEthiopianPhone(j.customer_phone)}</span></Td>
            <Td>{j.color_mode === "bw" ? "B/W" : "Colour"} · {j.paper_size} · {j.sides} · ×{j.copies}<span className="block text-xs text-muted-foreground">{j.files.length} file(s) · {j.fulfillment_method}</span></Td>
            <Td className="tabular-nums">{j.page_count ?? "?"}</Td>
            <Td className="tabular-nums">{j.total_etb !== null ? formatETB(toSantim(j.total_etb)) : "—"}</Td>
            <Td><StatusBadge kind="print" status={j.status} /></Td>
            <Td className="text-xs text-muted-foreground">{formatDateTime(j.created_at, "en")}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
