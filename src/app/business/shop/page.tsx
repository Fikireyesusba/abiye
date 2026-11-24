import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guards";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My shop" };

/** The shop's details as customers see them at checkout (changed by the Abiye office), and the staff member's account. */
export default async function BusinessShopPage() {
  await requirePermission("partner.own");
  const { data } = await (await createSupabaseServerClient()).rpc("partner_me");
  const m = (data ?? {}) as Record<string, string | number | null>;
  const rows: [string, React.ReactNode][] = [
    ["Shop", m.shop], ["City", m.city], ["Address", m.address_line], ["Landmark", m.landmark], ["Phone", m.phone],
    ["Opening hours", m.opening_hours],
    ["Map", m.map_url ? <a key="map" href={String(m.map_url)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open map</a> : null],
    ["Handling fee", formatETB(toSantim(Number(m.handling_fee_etb ?? 0))) + " per collected order"],
  ];
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">My shop</h1>
      <dl className="divide-y rounded-xl border bg-card text-sm" data-testid="shop-details">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8rem_1fr] gap-2 px-4 py-2"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">Customers see these details at checkout. To change them, contact the Abiye office.</p>
      <section className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <h2 className="font-medium">My account</h2>
        <p>{m.full_name} · User ID <span className="font-mono">{m.member_id}</span></p>
        <p className="text-muted-foreground">{m.email}</p>
        <Link href="/admin/password" className="text-primary hover:underline">Change my password</Link>
      </section>
    </div>
  );
}
