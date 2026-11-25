import { ActionForm } from "@/components/admin/action-form";
import { Field, fieldClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { deleteDocument, saveVehicle, uploadDocument } from "@/lib/admin/document-actions";
import { formatDateTime } from "@/lib/datetime";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export const STAFF_KINDS: [string, string][] = [
  ["fayda", "Fayda (national ID)"], ["passport", "Passport"], ["contract", "Employment contract"], ["driving_licence", "Driving licence"],
  ["cv", "CV"], ["certificate", "Certificate / diploma"], ["guarantee", "Guarantee letter"], ["medical", "Medical"], ["photo", "Photo"], ["other", "Other"],
];
export const VEHICLE_KINDS: [string, string][] = [
  ["libre", "Libre (registration book)"], ["insurance", "Insurance certificate"], ["inspection", "Annual inspection (Bolo)"],
  ["purchase", "Purchase / ownership"], ["photo", "Photo"], ["other", "Other"],
];
export const KIND_LABEL: Record<string, string> = Object.fromEntries([...STAFF_KINDS, ...VEHICLE_KINDS]);
export const VEHICLE_TYPE: Record<string, string> = { motorcycle: "Motorcycle", car: "Car", bicycle: "Bicycle", three_wheeler: "Three-wheeler (Bajaj)" };

/** Days until a date (negative = past). */
export const daysLeft = (d: string | null) => (d ? Math.ceil((Date.parse(`${d}T00:00:00Z`) - Date.now()) / 86400000) : null);
export function ExpiryBadge({ date }: { date: string | null }) {
  const n = daysLeft(date);
  if (n === null) return <span className="text-muted-foreground">—</span>;
  if (n < 0) return <Badge variant="destructive">expired {date}</Badge>;
  if (n <= 30) return <Badge variant="warning">{date} ({n} d)</Badge>;
  return <span className="tabular-nums">{date}</span>;
}

type Doc = { id: string; kind: string; title: string; file_path: string; mime: string; size_bytes: number; issued_on: string | null; expires_on: string | null; notes: string | null; created_at: string };

/** Documents with short-lived (5 minute) private links, upload form and delete. */
export async function DocumentList({ supabase, docs, target, kinds }: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; docs: Doc[]; target: { profileId?: string; vehicleId?: string }; kinds: [string, string][];
}) {
  const links = await Promise.all(docs.map(async (d) => (await supabase.storage.from("staff-documents").createSignedUrl(d.file_path, 300)).data?.signedUrl ?? null));
  return (
    <div className="space-y-5">
      {docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents yet.</p> : (
        <ul className="divide-y text-sm" data-testid="document-list">
          {docs.map((d, i) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                {links[i] ? <a href={links[i]!} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{d.title}</a> : <span className="font-medium">{d.title}</span>}
                <span className="block text-xs text-muted-foreground">{KIND_LABEL[d.kind] ?? d.kind} · {d.mime === "application/pdf" ? "PDF" : "image"} · {Math.ceil(d.size_bytes / 1024)} KB · added {formatDateTime(d.created_at, "en")}{d.issued_on ? ` · issued ${d.issued_on}` : ""}{d.notes ? ` · ${d.notes}` : ""}</span>
              </span>
              <span className="text-xs">Expires: <ExpiryBadge date={d.expires_on} /></span>
              <ActionForm action={deleteDocument} hidden={{ documentId: d.id }} submitLabel="Delete" size="sm" variant="outline" className="space-y-0" confirm={`Delete “${d.title}”? The file is removed for good.`} />
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={uploadDocument} hidden={{ profileId: target.profileId ?? "", vehicleId: target.vehicleId ?? "" }} submitLabel="Upload document" resetOnSuccess className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
        <Field label="Type"><select name="kind" required defaultValue="" className={fieldClass}><option value="">Choose…</option>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Name"><input name="title" required maxLength={120} placeholder="e.g. Fayda card (front and back)" className={fieldClass} /></Field>
        <Field label="Issued (optional)"><input name="issued_on" type="date" className={fieldClass} /></Field>
        <Field label="Expires (optional)" hint="You get a Telegram alert 30 days before."><input name="expires_on" type="date" className={fieldClass} /></Field>
        <Field label="File (PDF, JPG, PNG or WEBP, max 10 MB)" className="sm:col-span-2"><input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={fieldClass} aria-label="Document file" /></Field>
        <Field label="Notes (optional)" className="sm:col-span-2"><input name="notes" maxLength={500} className={fieldClass} /></Field>
      </ActionForm>
    </div>
  );
}

export interface VehicleValues {
  id?: string; kind?: string; owner?: string; plate_number?: string | null; make?: string | null; model?: string | null; year?: number | null; colour?: string | null;
  chassis_number?: string | null; engine_number?: string | null; libre_number?: string | null; insurance_company?: string | null; insurance_policy?: string | null;
  insurance_expiry?: string | null; inspection_expiry?: string | null; assigned_to?: string | null; status?: string; notes?: string | null;
}

export function VehicleForm({ v, people }: { v?: VehicleValues; people: { id: string; full_name: string; role: string }[] }) {
  const text = (name: keyof VehicleValues, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label}><input name={name} defaultValue={(v?.[name] as string | number | null | undefined) ?? ""} className={fieldClass} {...extra} /></Field>
  );
  return (
    <ActionForm action={saveVehicle} hidden={{ vehicleId: v?.id ?? "" }} submitLabel={v?.id ? "Save vehicle" : "Add vehicle"} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Type"><select name="kind" required defaultValue={v?.kind ?? "motorcycle"} className={fieldClass}>{Object.entries(VEHICLE_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Owner"><select name="owner" defaultValue={v?.owner ?? "company"} className={fieldClass}><option value="company">The shop (company vehicle)</option><option value="courier">The courier (own vehicle)</option></select></Field>
      {text("plate_number", "Plate number", { maxLength: 20, placeholder: "AA 3-12345" })}
      {text("make", "Make", { maxLength: 40, placeholder: "Bajaj, Toyota…" })}
      {text("model", "Model", { maxLength: 40 })}
      {text("year", "Year", { type: "number", min: 1950, max: 2100 })}
      {text("colour", "Colour", { maxLength: 30 })}
      {text("chassis_number", "Chassis number", { maxLength: 40 })}
      {text("engine_number", "Engine number", { maxLength: 40 })}
      {text("libre_number", "Libre number", { maxLength: 40 })}
      {text("insurance_company", "Insurance company", { maxLength: 80 })}
      {text("insurance_policy", "Insurance policy number", { maxLength: 40 })}
      {text("insurance_expiry", "Insurance expiry", { type: "date" })}
      {text("inspection_expiry", "Annual inspection (Bolo) expiry", { type: "date" })}
      <Field label="Rider / driver"><select name="assigned_to" defaultValue={v?.assigned_to ?? ""} className={fieldClass}><option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.role === "courier" ? " (courier)" : ""}</option>)}</select></Field>
      <Field label="Status"><select name="status" defaultValue={v?.status ?? "active"} className={fieldClass}><option value="active">In use</option><option value="in_repair">In repair</option><option value="retired">Retired</option></select></Field>
      <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><input name="notes" maxLength={1000} defaultValue={v?.notes ?? ""} className={fieldClass} /></Field>
    </ActionForm>
  );
}
