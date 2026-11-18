import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, fieldClass } from "@/components/admin/ui";
import { Input } from "@/components/ui/input";
import { savePriceRule } from "@/lib/admin/printing-actions";
import { requirePermission } from "@/lib/auth/guards";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Printing prices" };
type Rule = Database["public"]["Tables"]["printing_price_rules"]["Row"];

function RuleFields({ r }: { r?: Rule }) {
  return (
    <div className="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Field label="Type">
        <select name="color_mode" defaultValue={r?.color_mode ?? "bw"} className={fieldClass}><option value="bw">Black & white</option><option value="color">Colour</option></select>
      </Field>
      <Field label="Paper"><Input name="paper_size" defaultValue={r?.paper_size ?? "A4"} maxLength={10} required /></Field>
      <Field label="Sides">
        <select name="sides" defaultValue={r?.sides ?? "single"} className={fieldClass}><option value="single">Single</option><option value="double">Double</option></select>
      </Field>
      <Field label="ETB per page"><Input name="price_per_page_etb" type="number" min={0.01} step="0.01" required defaultValue={r?.price_per_page_etb} /></Field>
      <Field label="Order"><Input name="sort_order" type="number" min={0} defaultValue={r?.sort_order ?? 0} /></Field>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={r?.is_active ?? true} className="size-4 accent-[var(--primary)]" /> Offered</label>
    </div>
  );
}

export default async function PrintingPricesPage() {
  await requirePermission("printing.pricing");
  const supabase = await createSupabaseServerClient();
  const { data: rules } = await supabase.from("printing_price_rules").select("*").order("sort_order");
  return (
    <>
      <Link href="/admin/printing" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Printing jobs</Link>
      <PageHeader title="Printing prices" description="Price = pages × copies × price per page + service charge (Settings → Printing). Options without an active price need a manual quote." />
      <Panel title="Current prices">
        <ul className="divide-y">
          {(rules ?? []).map((r) => (
            <li key={r.id} className="py-3">
              <ActionForm action={savePriceRule} hidden={{ id: r.id }} submitLabel="Save" size="sm" variant="outline"><RuleFields r={r} /></ActionForm>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Add a price" className="mt-6">
        <ActionForm action={savePriceRule} hidden={{ id: "" }} submitLabel="Add price" resetOnSuccess><RuleFields /></ActionForm>
      </Panel>
    </>
  );
}
