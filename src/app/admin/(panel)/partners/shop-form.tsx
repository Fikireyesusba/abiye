import { ActionForm } from "@/components/admin/action-form";
import { Field, fieldClass } from "@/components/admin/ui";
import { savePartnerShop } from "@/lib/admin/partner-admin-actions";

export interface ShopFormValues {
  id?: string; name?: string; zone_id?: string; address_line?: string; landmark?: string | null; phone?: string; opening_hours?: string | null;
  map_url?: string | null; handling_fee_etb?: number | null; is_active?: boolean;
}

/** Partner shop details (what customers see at checkout) and the handling fee per collected order. */
export function ShopForm({ shop, zones }: { shop?: ShopFormValues; zones: { id: string; name_en: string; is_active: boolean; fee_etb: number }[] }) {
  return (
    <ActionForm action={savePartnerShop} hidden={{ shopId: shop?.id ?? "" }} submitLabel={shop?.id ? "Save shop" : "Add shop"} className="grid gap-3 sm:grid-cols-2">
      <Field label="Shop name" htmlFor="ps-name"><input id="ps-name" name="name" required maxLength={120} defaultValue={shop?.name ?? ""} className={fieldClass} /></Field>
      <Field label="City" htmlFor="ps-zone" hint="Switch the city on (with its delivery price) under Settings → Delivery cities so customers can choose the shop.">
        <select id="ps-zone" name="zone_id" required defaultValue={shop?.zone_id ?? ""} className={fieldClass}>
          <option value="">Choose a city…</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name_en}{z.is_active ? ` — ${z.fee_etb} ETB` : " (switched off)"}</option>)}
        </select>
      </Field>
      <Field label="Address (street, area, building)" htmlFor="ps-address" className="sm:col-span-2"><input id="ps-address" name="address_line" required maxLength={300} defaultValue={shop?.address_line ?? ""} className={fieldClass} /></Field>
      <Field label="Landmark (optional)" htmlFor="ps-landmark"><input id="ps-landmark" name="landmark" maxLength={200} defaultValue={shop?.landmark ?? ""} className={fieldClass} /></Field>
      <Field label="Phone" htmlFor="ps-phone"><input id="ps-phone" name="phone" required maxLength={20} placeholder="0911223344" defaultValue={shop?.phone ? `0${shop.phone.slice(4)}` : ""} className={fieldClass} /></Field>
      <Field label="Opening hours (optional)" htmlFor="ps-hours"><input id="ps-hours" name="opening_hours" maxLength={200} placeholder="Mon–Sat 8:00–19:00" defaultValue={shop?.opening_hours ?? ""} className={fieldClass} /></Field>
      <Field label="Map link (optional)" htmlFor="ps-map"><input id="ps-map" name="map_url" type="url" maxLength={500} placeholder="https://maps.google.com/…" defaultValue={shop?.map_url ?? ""} className={fieldClass} /></Field>
      <Field label="Handling fee per collected order (ETB)" htmlFor="ps-fee" hint="What Abiye pays the shop for each order a customer collects there.">
        <input id="ps-fee" name="handling_fee_etb" type="number" min={0} step="0.01" required defaultValue={shop?.handling_fee_etb ?? 0} className={fieldClass} />
      </Field>
      {shop?.id && (
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" name="is_active" defaultChecked={shop.is_active} /> Open (customers can choose it; staff can use the app)
        </label>
      )}
    </ActionForm>
  );
}
