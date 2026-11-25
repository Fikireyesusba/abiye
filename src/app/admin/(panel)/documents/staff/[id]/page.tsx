import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel } from "@/components/admin/ui";
import { requirePermission } from "@/lib/auth/guards";
import { isGuid } from "@/lib/orders/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DocumentList, STAFF_KINDS, VEHICLE_TYPE } from "../../doc-parts";

export const metadata: Metadata = { title: "Employee documents" };

/** One employee's documents (and the vehicles they ride). */
export default async function StaffDocumentsPage({ params }: PageProps<"/admin/documents/staff/[id]">) {
  await requirePermission("documents.manage");
  const { id } = await params;
  if (!isGuid(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: person }, { data: docs }, { data: rides }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role:admin_roles(name)").eq("id", id).maybeSingle(),
    supabase.from("documents").select("id, kind, title, file_path, mime, size_bytes, issued_on, expires_on, notes, created_at").eq("profile_id", id).order("created_at", { ascending: false }),
    supabase.from("vehicles").select("id, kind, plate_number").eq("assigned_to", id),
  ]);
  if (!person) notFound();
  return (
    <>
      <Link href="/admin/documents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Documents & vehicles</Link>
      <PageHeader title={person.full_name} description={`${(person.role as { name?: string } | null)?.name ?? ""} · HR details (Fayda / passport numbers) are under Staff → this person.`} />
      <Panel title="Documents" className="max-w-4xl">
        <DocumentList supabase={supabase} docs={docs ?? []} target={{ profileId: id }} kinds={STAFF_KINDS} />
      </Panel>
      {(rides ?? []).length > 0 && (
        <Panel title="Vehicles" className="mt-6 max-w-4xl">
          <ul className="text-sm">{(rides ?? []).map((v) => <li key={v.id}><Link href={`/admin/documents/vehicles/${v.id}`} className="text-primary hover:underline">{VEHICLE_TYPE[v.kind] ?? v.kind} · {v.plate_number ?? "no plate"}</Link></li>)}</ul>
        </Panel>
      )}
    </>
  );
}
