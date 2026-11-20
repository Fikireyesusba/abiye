import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { DatabaseUpdateNeeded, PageHeader, isMissingDbFunction } from "@/components/admin/ui";
import { Input } from "@/components/ui/input";
import { moderateReview } from "@/lib/admin/review-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reviews" };
const TABS = [
  { key: "pending", label: "To approve" },
  { key: "approved", label: "Published" },
  { key: "rejected", label: "Rejected" },
] as const;

export default async function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requirePermission("reviews.manage");
  const requested = first((await searchParams).status);
  const status = TABS.find((t) => t.key === requested)?.key ?? "pending";
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase.rpc("admin_product_reviews", { p_status: status, p_limit: 200 });
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Reviews" migration="20261120000032_product_reviews.sql" />;
  if (error) throw new Error("Could not load reviews");

  return (
    <>
      <PageHeader title="Reviews" description="Only customers who received the product (order completed) can review it. Nothing appears on the shop until you publish it. Edited reviews come back here." />
      <nav className="mb-5 flex gap-1 border-b" aria-label="Review status">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/reviews?status=${t.key}`} aria-current={t.key === status ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm", t.key === status ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {(rows ?? []).length === 0 && <p className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">No {status === "pending" ? "reviews waiting" : `${status} reviews`}.</p>}
      <ul className="space-y-4">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="space-y-3 rounded-xl border bg-card p-4 text-sm shadow-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/products/${r.product_slug}#reviews`} className="font-semibold text-primary hover:underline" target="_blank">{r.product_name}</Link>
              <span className="text-xs text-muted-foreground">{formatDateTime(r.updated_at, "en")}</span>
            </div>
            <p className="flex items-center gap-0.5" aria-label={`${r.rating} out of 5`}>
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} aria-hidden className={cn("size-4", i <= r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />)}
              <span className="ml-2 font-medium">{r.rating}/5</span>
            </p>
            {r.body ? <p className="whitespace-pre-line">{r.body}</p> : <p className="text-muted-foreground italic">No comment</p>}
            <p className="text-xs text-muted-foreground">
              Shown as <strong>{r.display_name}</strong> · {r.customer_email ?? "deleted account"}
              {r.order_number && <> · order <Link href={`/admin/orders/${r.order_id}`} className="text-primary hover:underline">{r.order_number}</Link></>}
              {r.reviewed_by_name && <> · {status} by {r.reviewed_by_name}</>}
              {r.review_note && <> · note: {r.review_note}</>}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {status !== "approved" && (
                <ActionForm action={moderateReview} hidden={{ reviewId: r.id, decision: "approved" }} submitLabel="Publish" size="sm" />
              )}
              {status !== "rejected" && (
                <ActionForm action={moderateReview} hidden={{ reviewId: r.id, decision: "rejected" }} submitLabel={status === "approved" ? "Unpublish" : "Reject"} size="sm" variant="outline" className="flex gap-2 space-y-0">
                  <Input name="note" maxLength={500} placeholder="Reason (shown to the customer, optional)" aria-label={`Reason for ${r.product_name}`} className="h-8" />
                </ActionForm>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
