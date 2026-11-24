import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, SubTabs, Table, Td, fieldClass, pickTab } from "@/components/admin/ui";
import { UserIdLink } from "@/components/admin/user-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setPartnerStaff } from "@/lib/admin/partner-admin-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime, zoneToday } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { surfaceUrl } from "@/lib/security/hosts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ShopForm } from "./shop-form";

export const metadata: Metadata = { title: "Partner shops" };
const etb = (n: number | string | null | undefined) => formatETB(toSantim(Number(n ?? 0)));

/** Partner shops (Super Admin): shops where customers collect orders in other cities, their staff, payouts and Excel. */
export default async function PartnersPage({ searchParams }: PageProps<"/admin/partners">) {
  await requirePermission("partners.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: shops }, { data: staff }, { data: zones }] = await Promise.all([
    supabase.rpc("admin_partner_shops"),
    supabase.rpc("admin_partner_staff"),
    supabase.from("delivery_zones").select("id, name_en, is_active, fee_etb").order("is_active", { ascending: false }).order("name_en"),
  ]);
  const list = shops ?? [];
  const people = staff ?? [];
  const TABS = [
    { key: "shops", label: "Shops", count: list.length },
    { key: "staff", label: "Shop staff", count: people.filter((p) => !p.shop_id).length, alert: true },
    { key: "add", label: "Add shop" },
    { key: "excel", label: "Excel" },
  ];
  const tab = pickTab(TABS, (await searchParams).tab);
  const appUrl = surfaceUrl("business") ?? surfaceUrl("courier");

  return (
    <>
      <PageHeader title="Partner shops" description="Shops in other cities where customers collect their orders. The courier and the shop check each other's PIN at hand-over; the customer collects with their own PIN and the shop earns its handling fee." />
      <SubTabs base="/admin/partners" tabs={TABS} active={tab} />

      {tab === "shops" && (
        <Table scroll head={["Shop", "City", "Status", "Staff", "On the way", "At the shop", "This month", "To pay", "Last collected"]} empty="No partner shops yet — Add shop.">
          {list.map((s) => (
            <tr key={s.id} data-testid="partner-row">
              <Td><Link href={`/admin/partners/${s.id}`} className="font-medium text-primary hover:underline">{s.name}</Link><span className="block text-xs text-muted-foreground">{s.address_line}</span></Td>
              <Td>{s.city}</Td>
              <Td>{s.is_active ? <Badge variant="success">open</Badge> : <Badge variant="secondary">closed</Badge>}</Td>
              <Td className="max-w-[12rem] text-xs">{s.staff || <span className="text-destructive">no staff</span>}</Td>
              <Td className="tabular-nums">{s.incoming}</Td>
              <Td className="tabular-nums">{s.at_shop}</Td>
              <Td className="tabular-nums">{s.collected_month} collected</Td>
              <Td className="tabular-nums font-medium">{etb(s.unpaid_etb)}</Td>
              <Td className="text-xs text-muted-foreground">{s.last_collected_at ? formatDateTime(s.last_collected_at, "en") : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "staff" && (
        <Panel title="Shop staff">
          <p className="mb-3 text-sm text-muted-foreground">
            Add a person under Staff → Add staff member with the permission set “Partner shop”, then choose their shop here.
            They sign in to the Abiye Business app{appUrl ? <> at <span className="font-mono">{appUrl}</span></> : null} (email, password and authenticator code).
          </p>
          {people.length === 0 ? <p className="text-sm text-muted-foreground">No “Partner shop” staff yet.</p> : (
            <ul className="divide-y" data-testid="partner-staff">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1"><span className="font-medium">{p.full_name}</span> <UserIdLink id={p.member_id} /> <span className="text-xs text-muted-foreground">{p.email}{p.is_active ? "" : " · deactivated"}</span></span>
                  <ActionForm action={setPartnerStaff} hidden={{ profileId: p.id }} submitLabel="Save" size="sm" className="flex items-center gap-2 space-y-0">
                    <select name="shopId" defaultValue={p.shop_id ?? ""} className={`${fieldClass} h-8 w-56`} aria-label={`Shop of ${p.full_name}`}>
                      <option value="">No shop</option>
                      {list.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.city}</option>)}
                    </select>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "add" && (
        <Panel title="Add a partner shop" className="max-w-3xl">
          <ShopForm zones={(zones ?? []).map((z) => ({ ...z, fee_etb: Number(z.fee_etb) }))} />
        </Panel>
      )}

      {tab === "excel" && (
        <Panel title="Excel: orders collected at partner shops" className="max-w-lg">
          <form method="get" action="/admin/exports/download" className="space-y-3" data-testid="partner-orders-export">
            <input type="hidden" name="kind" value="partner_orders" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input type="date" name="from" required defaultValue={`${zoneToday().slice(0, 7)}-01`} className={fieldClass} /></Field>
              <Field label="To"><input type="date" name="to" required defaultValue={zoneToday()} className={fieldClass} /></Field>
            </div>
            <Field label="Shop">
              <select name="shop" defaultValue="" className={fieldClass}>
                <option value="">All shops</option>
                {list.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.city}</option>)}
              </select>
            </Field>
            <Button type="submit" variant="outline"><Download /> Excel</Button>
            <p className="text-xs text-muted-foreground">Order, shop, city, status, courier (User ID), paid / picked up / at the shop / collected times, delivery fee paid, city price, order total, shop earned and when it was paid out.</p>
          </form>
        </Panel>
      )}
    </>
  );
}
