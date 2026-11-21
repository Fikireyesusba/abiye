import { ActionForm } from "@/components/admin/action-form";
import { Field, fieldClass } from "@/components/admin/ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveProduct } from "@/lib/admin/catalog-actions";

export interface ProductFormValues {
  id?: string;
  name_en?: string; name_am?: string; slug?: string; sku?: string; brand?: string | null; category_id?: string; audience?: string | null;
  price_etb?: number; sale_price_etb?: number | null; description_en?: string; description_am?: string;
  status?: string; is_featured?: boolean; track_inventory?: boolean; low_stock_threshold?: number; stock_quantity?: number;
}

export function ProductForm({ values = {}, categories }: {
  values?: ProductFormValues;
  categories: { id: string; name_en: string; department: string; parent_id: string | null }[];
}) {
  const isNew = !values.id;
  const groups = ["cosmetics", "electronics"].map((d) => ({ d, items: categories.filter((c) => c.department === d && c.parent_id) }));
  return (
    <ActionForm action={saveProduct} hidden={{ id: values.id ?? "" }} submitLabel={isNew ? "Create product" : "Save changes"} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name (English)" htmlFor="name_en"><Input id="name_en" name="name_en" required maxLength={160} defaultValue={values.name_en} /></Field>
        <Field label="Name (Amharic)" htmlFor="name_am"><Input id="name_am" name="name_am" required maxLength={160} defaultValue={values.name_am} lang="am" /></Field>
        <Field label="SKU" htmlFor="sku" hint="Unique stock code, e.g. PF-OUD-100"><Input id="sku" name="sku" required maxLength={40} defaultValue={values.sku} /></Field>
        <Field label="URL slug" htmlFor="slug" hint="Leave empty to generate from the English name"><Input id="slug" name="slug" maxLength={100} defaultValue={values.slug} /></Field>
        <Field label="Category" htmlFor="category_id">
          <select id="category_id" name="category_id" required defaultValue={values.category_id ?? ""} className={fieldClass}>
            <option value="" disabled>Choose a category</option>
            {groups.map((g) => (
              <optgroup key={g.d} label={g.d[0].toUpperCase() + g.d.slice(1)}>
                {g.items.map((c) => <option key={c.id} value={c.id}>{c.name_en}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Brand (optional)" htmlFor="brand"><Input id="brand" name="brand" maxLength={80} defaultValue={values.brand ?? ""} /></Field>
        <Field label="For (optional)" htmlFor="audience" hint="e.g. perfume for women or men. Customers can filter by it; Unisex shows under both.">
          <select id="audience" name="audience" defaultValue={values.audience ?? ""} className={fieldClass}>
            <option value="">Everyone (not shown)</option>
            <option value="women">Women</option>
            <option value="men">Men</option>
            <option value="unisex">Unisex (women and men)</option>
          </select>
        </Field>
        <Field label="Price (ETB)" htmlFor="price_etb"><Input id="price_etb" name="price_etb" type="number" min="0.01" step="0.01" required defaultValue={values.price_etb} /></Field>
        <Field label="Sale price (ETB, optional)" htmlFor="sale_price_etb" hint="Must be lower than the price. Empty = no discount.">
          <Input id="sale_price_etb" name="sale_price_etb" type="number" min="0.01" step="0.01" defaultValue={values.sale_price_etb ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Description (English)" htmlFor="description_en"><Textarea id="description_en" name="description_en" rows={5} maxLength={5000} defaultValue={values.description_en} /></Field>
        <Field label="Description (Amharic)" htmlFor="description_am"><Textarea id="description_am" name="description_am" rows={5} maxLength={5000} defaultValue={values.description_am} lang="am" /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Status" htmlFor="status" hint="Only Active products are visible in the shop">
          <select id="status" name="status" defaultValue={values.status ?? "draft"} className={fieldClass}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        {isNew && (
          <Field label="Opening stock" htmlFor="stock_quantity" hint="Later changes go through Inventory">
            <Input id="stock_quantity" name="stock_quantity" type="number" min="0" step="1" defaultValue={0} />
          </Field>
        )}
        <Field label="Low-stock alert at" htmlFor="low_stock_threshold">
          <Input id="low_stock_threshold" name="low_stock_threshold" type="number" min="0" step="1" defaultValue={values.low_stock_threshold ?? 5} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_featured" defaultChecked={values.is_featured} className="size-4 accent-[var(--primary)]" /> Feature on homepage</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="track_inventory" defaultChecked={values.track_inventory ?? true} className="size-4 accent-[var(--primary)]" /> Track stock</label>
      </div>
    </ActionForm>
  );
}
