import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, SubTabs, Table, Td, pickTab } from "@/components/admin/ui";
import { UserIdLink } from "@/components/admin/user-id";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { daysLeft, ExpiryBadge, VEHICLE_TYPE, VehicleForm } from "./doc-parts";

export const metadata: Metadata = { title: "Documents & vehicles" };
const ITEM: Record<string, string> = {
  document: "Document", vehicle_insurance: "Vehicle insurance", vehicle_inspection: "Annual inspection (Bolo)",
  courier_licence: "Courier's driving licence", courier_insurance: "Courier's own vehicle insurance",
};

/** Employee documents, the vehicle register (cars, motorcycles…) with their documents, and what expires soon. */
export default async function DocumentsPage({ searchParams }: PageProps<"/admin/documents">) {
  await requirePermission("documents.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: staff }, { data: docs }, { data: vehicles }, { data: expiring }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, is_active, member:customer_accounts(member_id), role:admin_roles(key, name)").is("removed_at", null).order("full_name"),
    supabase.from("documents").select("profile_id, vehicle_id, expires_on"),
    supabase.from("vehicles").select("*, rider:profiles(full_name)").order("status").order("plate_number"),
    supabase.rpc("admin_expiring", { p_days: 60 }),
  ]);
  const count = new Map<string, { n: number; soon: number }>();
  for (const d of docs ?? []) {
    const k = d.profile_id ?? d.vehicle_id ?? "";
    const c = count.get(k) ?? { n: 0, soon: 0 };
    c.n++;
    if ((daysLeft(d.expires_on) ?? 999) <= 30) c.soon++;
    count.set(k, c);
  }
  const soon = (expiring ?? []).filter((e) => (daysLeft(e.expires_on) ?? 999) <= 30).length;
  const TABS = [
    { key: "staff", label: "Employees", count: (staff ?? []).length },
    { key: "vehicles", label: "Vehicles", count: (vehicles ?? []).length },
    { key: "expiring", label: "Expiring", count: soon, alert: true },
    { key: "add", label: "Add vehicle" },
  ];
  const tab = pickTab(TABS, (await searchParams).tab);
  const people = (staff ?? []).filter((s) => s.is_active).map((s) => ({ id: s.id, full_name: s.full_name, role: (s.role as { key?: string } | null)?.key ?? "" }));

  return (
    <>
      <PageHeader title="Documents & vehicles" description="Private documents of every employee and vehicle (only people with this section can open them; links last 5 minutes). Expiry alerts go to the security Telegram group 30 days before." />
      <SubTabs base="/admin/documents" tabs={TABS} active={tab} />

      {tab === "staff" && (
        <Table scroll head={["User ID", "Name", "Permission set", "Documents", "Expiring ≤30 d"]} empty="No staff yet.">
          {(staff ?? []).map((s) => {
            const c = count.get(s.id);
            return (
              <tr key={s.id} data-testid="doc-staff-row">
                <Td><UserIdLink id={(s.member as { member_id?: string } | null)?.member_id ?? undefined} /></Td>
                <Td><Link href={`/admin/documents/staff/${s.id}`} className="font-medium text-primary hover:underline">{s.full_name}</Link>{!s.is_active && <Badge variant="secondary" className="ml-2">deactivated</Badge>}</Td>
                <Td>{(s.role as { name?: string } | null)?.name ?? "—"}</Td>
                <Td className="tabular-nums">{c?.n ?? 0}</Td>
                <Td className={`tabular-nums ${c?.soon ? "font-semibold text-destructive" : ""}`}>{c?.soon ?? 0}</Td>
              </tr>
            );
          })}
        </Table>
      )}

      {tab === "vehicles" && (
        <Table scroll head={["Vehicle", "Plate", "Owner", "Rider", "Status", "Insurance", "Bolo", "Documents"]} empty="No vehicles yet — Add vehicle.">
          {(vehicles ?? []).map((v) => (
            <tr key={v.id} data-testid="vehicle-row">
              <Td><Link href={`/admin/documents/vehicles/${v.id}`} className="font-medium text-primary hover:underline">{VEHICLE_TYPE[v.kind] ?? v.kind}{v.make ? ` · ${v.make} ${v.model ?? ""}` : ""}</Link></Td>
              <Td className="font-mono">{v.plate_number ?? "—"}</Td>
              <Td>{v.owner === "company" ? "Shop" : "Courier"}</Td>
              <Td>{(v.rider as { full_name?: string } | null)?.full_name ?? "—"}</Td>
              <Td>{v.status === "active" ? <Badge variant="success">in use</Badge> : v.status === "in_repair" ? <Badge variant="warning">in repair</Badge> : <Badge variant="secondary">retired</Badge>}</Td>
              <Td className="text-xs"><ExpiryBadge date={v.insurance_expiry} /></Td>
              <Td className="text-xs"><ExpiryBadge date={v.inspection_expiry} /></Td>
              <Td className="tabular-nums">{count.get(v.id)?.n ?? 0}</Td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "expiring" && (
        <Panel title="Expired or expiring in the next 60 days">
          {(expiring ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nothing expires in the next 60 days.</p> : (
            <ul className="divide-y text-sm" data-testid="expiring-list">
              {(expiring ?? []).map((e) => (
                <li key={`${e.item}-${e.ref_id}`} className="flex flex-wrap items-center gap-2 py-2">
                  <ExpiryBadge date={e.expires_on} />
                  <span className="font-medium">{e.label}</span>
                  <span className="text-muted-foreground">{ITEM[e.item] ?? e.item} · {e.who}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Includes documents with an expiry date, vehicle insurance and annual inspection (Bolo), and couriers&apos; driving licences and own-vehicle insurance (Couriers & delivery).</p>
        </Panel>
      )}

      {tab === "add" && (
        <Panel title="Add a vehicle">
          <VehicleForm people={people} />
        </Panel>
      )}
    </>
  );
}
