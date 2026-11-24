import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { requirePermission } from "@/lib/auth/guards";
import { setDuty } from "@/lib/courier/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Go on duty" };

/** Going on duty: choose the cities you can deliver to today (the office sees you for those cities). */
export default async function DutyPage() {
  await requirePermission("deliveries.own");
  const supabase = await createSupabaseServerClient();
  const [{ data: cities }, { data: me }] = await Promise.all([supabase.rpc("courier_cities"), supabase.rpc("courier_me")]);
  const chosen = new Set(((me as { cities?: { id: string }[] } | null)?.cities ?? []).map((c) => c.id));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Go on duty</h1>
      <p className="text-sm text-muted-foreground">Tick the cities you can deliver to now. The office gives you deliveries for these cities.</p>
      <ActionForm action={setDuty} hidden={{ on: "true" }} submitLabel="Go on duty" className="space-y-3 [&_button]:w-full">
        <ul className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto rounded-xl border bg-card p-3" data-testid="duty-cities">
          {(cities ?? []).map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 rounded-md p-1 text-sm hover:bg-muted/40">
                <input type="checkbox" name="zone" value={c.id} defaultChecked={chosen.has(c.id)} className="size-4 accent-[var(--primary)]" /> {c.name_en}
              </label>
            </li>
          ))}
        </ul>
        {(cities ?? []).length === 0 && <p className="text-sm text-destructive">No delivery cities are open yet — ask the office.</p>}
      </ActionForm>
    </div>
  );
}
