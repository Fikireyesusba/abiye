import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel } from "@/components/admin/ui";
import { StatusBadge } from "@/components/status/status-badge";
import { Input } from "@/components/ui/input";
import { deletePrintingFiles, quotePrintingJob, updatePrintingStatus } from "@/lib/admin/printing-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { isGuid } from "@/lib/orders/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatEthiopianPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Printing job" };
const etb = (n: number) => formatETB(toSantim(n));
const NEXT: Record<string, { status: string; label: string }[]> = {
  printing: [{ status: "ready", label: "Mark ready" }],
  ready: [{ status: "completed", label: "Mark collected / delivered" }, { status: "printing", label: "Back to printing" }],
};

export default async function PrintingJobPage({ params }: PageProps<"/admin/printing/[id]">) {
  const ctx = await requirePermission("printing.view");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("printing_jobs")
    .select("*, files:printing_files(*), history:printing_job_history(*), order:orders(id, order_number, status, payment_status)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const manage = ctx.permissions.has("printing.manage");
  // Short-lived signed download links (private bucket), named after the customer's file.
  const links = await Promise.all(
    job.files.map(async (f) => f.deleted_at ? null
      : (await supabase.storage.from("printing-files").createSignedUrl(f.storage_path, 300, { download: f.original_name })).data?.signedUrl ?? null),
  );
  const history = [...job.history].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const quotable = ["submitted", "awaiting_quote", "awaiting_payment"].includes(job.status) && !job.order_id;
  const cancellable = ["submitted", "awaiting_quote", "awaiting_payment"].includes(job.status);
  const inProduction = ["payment_verification", "printing", "ready"].includes(job.status);
  const liveFiles = job.files.filter((f) => !f.deleted_at).length;

  return (
    <>
      <Link href="/admin/printing" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Printing jobs</Link>
      <PageHeader title={job.job_number} description={`Received ${formatDateTime(job.created_at, "en")}`} actions={<StatusBadge kind="print" status={job.status} />} />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Files">
            <ul className="divide-y text-sm">
              {job.files.map((f, i) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{f.original_name}</span>
                  <span className="text-xs text-muted-foreground">{f.page_count ? `${f.page_count} page(s)` : "pages not counted"} · {(f.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                  {links[i] ? (
                    <a href={links[i]!} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-secondary"><Download className="size-3.5" /> Download</a>
                  ) : <span className="text-xs text-muted-foreground">deleted</span>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Download links expire after 5 minutes. Files are deleted automatically after {formatDateTime(job.files_delete_after, "en")}
              {inProduction && " (not while the job is in production)"}.
            </p>
            {manage && liveFiles > 0 && !inProduction && (
              <ActionForm action={deletePrintingFiles} hidden={{ jobId: job.id }} submitLabel="Delete customer files now" variant="outline" size="sm"
                confirm="Permanently delete this customer's files?" className="mt-3" />
            )}
          </Panel>

          {manage && quotable && (
            <Panel title={job.status === "awaiting_quote" ? "Set the price (needed before the customer can pay)" : "Re-quote"}>
              <ActionForm action={quotePrintingJob} hidden={{ jobId: job.id }} submitLabel="Save quote" keepSuccess>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Total pages (all files)" hint="Per copy"><Input name="pageCount" type="number" min={1} max={5000} required defaultValue={job.page_count ?? ""} /></Field>
                  <Field label="Total price (ETB, optional)" hint="Empty = calculate from the price list"><Input name="total" type="number" min={1} step="0.01" /></Field>
                  <Field label="Note (optional)"><Input name="note" maxLength={500} /></Field>
                </div>
              </ActionForm>
            </Panel>
          )}

          <Panel title="Progress">
            <ol className="space-y-2 border-l pl-4 text-sm">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full bg-printing" aria-hidden />
                  <span className="font-medium">{h.to_status.replaceAll("_", " ")}</span>{h.note && <> — {h.note}</>}
                  <span className="text-muted-foreground"> · {formatDateTime(h.created_at, "en")}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-6">
          {manage && (NEXT[job.status]?.length || cancellable) && (
            <Panel title="Update status">
              <div className="space-y-3">
                {(NEXT[job.status] ?? []).map((n) => (
                  <ActionForm key={n.status} action={updatePrintingStatus} hidden={{ jobId: job.id, status: n.status }} submitLabel={n.label}
                    variant={n.status === "printing" ? "outline" : "default"} className="[&_button]:w-full" />
                ))}
                {cancellable && (
                  <ActionForm action={updatePrintingStatus} hidden={{ jobId: job.id, status: "cancelled" }} submitLabel="Cancel job" variant="outline"
                    confirm="Cancel this printing job?" className="[&_button]:w-full" />
                )}
              </div>
            </Panel>
          )}
          <Panel title="Job">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted-foreground">Customer</dt><dd className="font-medium">{job.customer_name} · <a className="text-primary" href={`tel:${job.customer_phone}`}>{formatEthiopianPhone(job.customer_phone)}</a></dd></div>
              <div><dt className="text-muted-foreground">Options</dt><dd>{job.color_mode === "bw" ? "Black & white" : "Colour"} · {job.paper_size} · {job.sides}-sided · {job.copies} cop{job.copies === 1 ? "y" : "ies"}</dd></div>
              <div><dt className="text-muted-foreground">Pages per copy</dt><dd>{job.page_count ?? "not counted"}{job.page_count_source && ` (${job.page_count_source === "auto" ? "counted automatically" : "set by staff"})`}</dd></div>
              <div><dt className="text-muted-foreground">Price</dt><dd className="font-semibold">{job.total_etb !== null ? etb(job.total_etb) : "awaiting quote"}</dd></div>
              <div><dt className="text-muted-foreground">Collection</dt><dd>{job.fulfillment_method}</dd></div>
              {job.customer_notes && <div><dt className="text-muted-foreground">Customer notes</dt><dd className="whitespace-pre-line">{job.customer_notes}</dd></div>}
              {job.order && (
                <div><dt className="text-muted-foreground">Order</dt><dd>
                  {ctx.permissions.has("orders.view_all") ? <Link className="text-primary hover:underline" href={`/admin/orders/${job.order.id}`}>{job.order.order_number}</Link> : job.order.order_number}
                  {" "}· {job.order.payment_status}
                </dd></div>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
