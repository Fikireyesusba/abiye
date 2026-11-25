import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel } from "@/components/admin/ui";
import { requirePermission } from "@/lib/auth/guards";
import { isGuid } from "@/lib/orders/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DocumentList, VEHICLE_KINDS, VEHICLE_TYPE, VehicleForm } from "../../doc-parts";

export const metadata: Metadata = { title: "Vehicle" };

/** One vehicle: details (plate, libre, insurance, Bolo, rider) and its documents. */
export default async function VehiclePage({ params, searchParams }: PageProps<"/admin/documents/vehicles/[id]">) {
  await requirePermission("documents.manage");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const created = (await searchParams).created === "1";
  const supabase = await createSupabaseServerClient();
  const [{ data: v }, { data: docs }, { data: staff }] = await Promise.all([
    supabase.from("vehicles").select("*").eq("id", id).maybeSingle(),
    supabase.from("documents").select("id, kind, title, file_path, mime, size_bytes, issued_on, expires_on, notes, created_at").eq("vehicle_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, is_active, role:admin_roles(key)").is("removed_at", null).eq("is_active", true).order("full_name"),
  ]);
  if (!v) notFound();
  const people = (staff ?? []).map((s) => ({ id: s.id, full_name: s.full_name, role: (s.role as { key?: string } | null)?.key ?? "" }));
  return (
    <>
      <Link href="/admin/documents?tab=vehicles" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Vehicles</Link>
      <PageHeader title={`${VEHICLE_TYPE[v.kind] ?? v.kind} ${v.plate_number ?? ""}`} description={[v.make, v.model, v.year, v.colour].filter(Boolean).join(" · ")} />
      {created && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm" role="status">Vehicle added. Now upload its libre, insurance and Bolo below.</p>}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Panel title="Documents"><DocumentList supabase={supabase} docs={docs ?? []} target={{ vehicleId: id }} kinds={VEHICLE_KINDS} /></Panel>
        <Panel title="Details"><VehicleForm v={v} people={people} /></Panel>
      </div>
    </>
  );
}
