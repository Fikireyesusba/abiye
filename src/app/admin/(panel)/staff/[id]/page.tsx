import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, fieldClass } from "@/components/admin/ui";
import { saveStaffHr } from "@/lib/admin/staff-hr-actions";
import { memberIds } from "@/lib/admin/member-ids";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "HR details" };
const local = (p: string | null | undefined) => (p ? `0${p.slice(4)}` : "");

/** HR details of one staff member (staff.manage only). ID numbers never go into the Activity log or Telegram. */
export default async function StaffHrPage({ params }: PageProps<"/admin/staff/[id]">) {
  await requirePermission("staff.manage");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: p }, { data: hr }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, date_of_birth, sex, is_active, created_at, role:admin_roles(name)").eq("id", id).maybeSingle(),
    supabase.from("staff_hr").select("*").eq("profile_id", id).maybeSingle(),
  ]);
  if (!p) notFound();
  const mid = (await memberIds([id])).get(id);
  return (
    <>
      <Link href="/admin/staff" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Staff</Link>
      <PageHeader title={p.full_name} description={`User ID ${mid ?? "—"} · ${(p.role as { name?: string } | null)?.name ?? ""} · ${p.is_active ? "active" : "deactivated"}`} />
      <Panel title="HR details" className="max-w-3xl">
        <p className="mb-3 text-sm text-muted-foreground">Only people who manage staff see this. ID numbers are kept here only — never in the Activity log or Telegram.</p>
        <ActionForm action={saveStaffHr} hidden={{ profileId: id }} submitLabel="Save HR details" className="space-y-4" data-testid="hr-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job title"><input name="job_title" maxLength={80} defaultValue={hr?.job_title ?? ""} placeholder="e.g. Courier, Cashier" className={fieldClass} /></Field>
            <Field label="Start date"><input name="start_date" type="date" defaultValue={hr?.start_date ?? ""} className={fieldClass} /></Field>
            <Field label="Fayda number (national ID)" hint="12–16 digits"><input name="fayda_number" inputMode="numeric" maxLength={16} defaultValue={hr?.fayda_number ?? ""} className={`${fieldClass} font-mono`} /></Field>
            <Field label="Passport number (optional)"><input name="passport_number" maxLength={12} defaultValue={hr?.passport_number ?? ""} className={`${fieldClass} font-mono uppercase`} /></Field>
            <Field label="Address"><input name="address" maxLength={300} defaultValue={hr?.address ?? ""} className={fieldClass} /></Field>
            <Field label="City"><input name="city" maxLength={80} defaultValue={hr?.city ?? ""} className={fieldClass} /></Field>
            <Field label="Emergency contact name"><input name="emergency_name" maxLength={120} defaultValue={hr?.emergency_name ?? ""} className={fieldClass} /></Field>
            <Field label="Emergency contact phone"><input name="emergency_phone" inputMode="tel" defaultValue={local(hr?.emergency_phone)} placeholder="0911223344" className={fieldClass} /></Field>
          </div>
          <Field label="Notes"><textarea name="notes" rows={3} maxLength={1000} defaultValue={hr?.notes ?? ""} className={fieldClass} /></Field>
        </ActionForm>
        <dl className="mt-4 grid gap-1 border-t pt-3 text-sm sm:grid-cols-2">
          <div><dt className="inline text-muted-foreground">Phone: </dt><dd className="inline">{p.phone ?? "—"}</dd></div>
          <div><dt className="inline text-muted-foreground">Date of birth: </dt><dd className="inline">{p.date_of_birth ?? "—"}</dd></div>
          <div><dt className="inline text-muted-foreground">Sex: </dt><dd className="inline capitalize">{p.sex ?? "—"}</dd></div>
          <div><dt className="inline text-muted-foreground">Account created: </dt><dd className="inline">{formatDateTime(p.created_at, "en")}</dd></div>
          {hr?.updated_at && <div><dt className="inline text-muted-foreground">HR details updated: </dt><dd className="inline">{formatDateTime(hr.updated_at, "en")}</dd></div>}
        </dl>
      </Panel>
    </>
  );
}
