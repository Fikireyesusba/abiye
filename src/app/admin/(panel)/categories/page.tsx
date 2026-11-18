import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { deleteCategory, saveCategory } from "@/lib/admin/catalog-actions";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Categories" };
type Cat = { id: string; parent_id: string | null; department: string; slug: string; name_en: string; name_am: string; sort_order: number; is_active: boolean };

function CategoryFields({ c, parents }: { c?: Cat; parents: Cat[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Name (English)"><Input name="name_en" required maxLength={80} defaultValue={c?.name_en} /></Field>
      <Field label="Name (Amharic)"><Input name="name_am" required maxLength={80} defaultValue={c?.name_am} lang="am" /></Field>
      <Field label="URL slug"><Input name="slug" maxLength={100} defaultValue={c?.slug} placeholder="auto" /></Field>
      <Field label="Department">
        <select name="department" defaultValue={c?.department ?? "cosmetics"} className={fieldClass}>
          <option value="cosmetics">Cosmetics</option><option value="electronics">Electronics</option><option value="printing">Printing</option>
        </select>
      </Field>
      <Field label="Parent" hint="Empty = top-level department category">
        <select name="parent_id" defaultValue={c?.parent_id ?? ""} className={fieldClass}>
          <option value="">— none —</option>
          {parents.filter((p) => p.id !== c?.id).map((p) => <option key={p.id} value={p.id}>{p.name_en}</option>)}
        </select>
      </Field>
      <Field label="Sort order"><Input name="sort_order" type="number" min={0} max={1000} defaultValue={c?.sort_order ?? 0} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={c?.is_active ?? true} className="size-4 accent-[var(--primary)]" /> Visible in shop</label>
    </div>
  );
}

export default async function CategoriesPage() {
  await requirePermission("categories.manage");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("categories").select("id, parent_id, department, slug, name_en, name_am, sort_order, is_active").order("sort_order");
  const cats = (data ?? []) as Cat[];
  const parents = cats.filter((c) => !c.parent_id);

  return (
    <>
      <PageHeader title="Categories" description="Departments and their subcategories. Products are assigned to subcategories." />
      <Panel title="Add category" className="mb-6">
        <ActionForm action={saveCategory} hidden={{ id: "" }} submitLabel="Create category" resetOnSuccess><CategoryFields parents={parents} /></ActionForm>
      </Panel>
      <div className="space-y-6">
        {parents.map((p) => (
          <Panel key={p.id} title={`${p.name_en} · ${p.name_am}`}>
            <ul className="divide-y">
              {[p, ...cats.filter((c) => c.parent_id === p.id)].map((c) => (
                <li key={c.id} className="py-3">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      <span className={c.parent_id ? "pl-4" : "font-semibold"}>{c.name_en}</span>
                      <span className="text-sm text-muted-foreground">{c.name_am} · /{c.slug}</span>
                      {!c.is_active && <Badge variant="secondary">hidden</Badge>}
                      <span className="ml-auto text-xs text-primary">Edit</span>
                    </summary>
                    <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
                      <ActionForm action={saveCategory} hidden={{ id: c.id }} submitLabel="Save"><CategoryFields c={c} parents={parents} /></ActionForm>
                      <ActionForm action={deleteCategory} hidden={{ id: c.id }} submitLabel="Delete" variant="outline" size="sm" confirm={`Delete “${c.name_en}”?`} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
