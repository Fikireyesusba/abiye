import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, fieldClass } from "@/components/admin/ui";
import { requirePermission } from "@/lib/auth/guards";
import { updateMyDetails } from "@/lib/courier/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };
const VEHICLE: Record<string, string> = { on_foot: "On foot", bicycle: "Bicycle", motorcycle: "Motorcycle", car: "Car" };

/** The courier's own details (name and email are set by the office). */
export default async function CourierProfilePage() {
  await requirePermission("deliveries.own");
  const { data } = await (await createSupabaseServerClient()).rpc("courier_me");
  const me = (data ?? {}) as Record<string, string | number | null>;
  const local = typeof me.phone === "string" ? `0${me.phone.slice(4)}` : "";
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Profile</h1>
      <dl className="space-y-1 rounded-xl border bg-card p-4 text-sm" data-testid="courier-profile">
        <div><dt className="inline text-muted-foreground">Name: </dt><dd className="inline font-medium">{me.full_name}</dd></div>
        <div><dt className="inline text-muted-foreground">User ID: </dt><dd className="inline font-mono">{me.member_id ?? "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Email: </dt><dd className="inline break-all">{me.email}</dd></div>
        <div><dt className="inline text-muted-foreground">Deliveries completed: </dt><dd className="inline">{me.total_delivered ?? 0}</dd></div>
        <div><dt className="inline text-muted-foreground">Delivers by: </dt><dd className="inline">{VEHICLE[String(me.vehicle ?? "")] ?? "not set yet"}
          {me.vehicle_make ? ` · ${me.vehicle_make} ${me.vehicle_model ?? ""}` : ""}{me.plate_number ? ` · ${me.plate_number}` : ""}</dd></div>
        {me.licence_expiry && <div><dt className="inline text-muted-foreground">Driving licence valid until: </dt><dd className="inline">{me.licence_expiry}</dd></div>}
        {me.insurance_expiry && <div><dt className="inline text-muted-foreground">Insurance valid until: </dt><dd className="inline">{me.insurance_expiry}</dd></div>}
      </dl>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-medium">My details</h2>
        <ActionForm action={updateMyDetails} submitLabel="Save" className="space-y-3">
          <Field label="Phone"><input name="phone" inputMode="tel" required defaultValue={local} placeholder="0911223344" className={fieldClass} /></Field>

        </ActionForm>
      </section>
      <Link href="/admin/password" className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm hover:bg-muted/40">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden /> Change password
      </Link>
      <p className="text-xs text-muted-foreground">Name, email, vehicle or documents wrong? Ask the office to change them.</p>
    </div>
  );
}
