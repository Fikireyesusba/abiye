import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, PauseCircle } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { Field, PageHeader, Panel, fieldClass } from "@/components/admin/ui";
import { saveSettings } from "@/lib/admin/settings-actions";
import { requirePermission } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { SERVICE_KEYS, type ServiceKey } from "@/lib/validation/settings";

export const metadata: Metadata = { title: "Manage services" };

const INFO: Record<ServiceKey, { label: string; off: string }> = {
  shop: { label: "Online shop (products)", off: "Products can still be browsed, but nobody can add them to the basket, check out or send a payment receipt for a product order." },
  printing: { label: "Printing", off: "No new documents can be uploaded and printing orders cannot be paid. The price list stays visible." },
  wallet: { label: "Wallet (shop balance)", off: "No top-ups and no paying with the balance. Existing balances are kept." },
  reviews: { label: "Product reviews", off: "Customers cannot write new reviews. Approved reviews stay visible." },
  signup: { label: "New accounts (sign-up)", off: "Nobody can create a new customer account. Existing customers can still sign in." },
};

/** Switch customer services on / off. The database refuses a switched-off service; customers see "temporarily unavailable". */
export default async function ManageServicesPage() {
  await requirePermission("settings.manage");
  const { services } = await getSiteSettings();
  const offCount = SERVICE_KEYS.filter((k) => !services[k]).length;
  return (
    <>
      <PageHeader title="Manage services" description="Pause a service the shop is not offering right now. Customers see it as temporarily unavailable; the database refuses it, so it cannot be used by mistake. Takes effect immediately." />
      <Panel title={offCount ? `${offCount} service${offCount === 1 ? "" : "s"} paused` : "All services are on"} className="max-w-3xl">
        <ActionForm action={saveSettings} hidden={{ key: "services" }} submitLabel="Save" className="space-y-4"
          confirm="Save the service switches? Paused services become unavailable for customers immediately.">
          <ul className="divide-y rounded-lg border">
            {SERVICE_KEYS.map((k) => (
              <li key={k} className="flex items-start gap-3 p-4" data-service={k}>
                <input id={`svc-${k}`} type="checkbox" name={k} defaultChecked={services[k]} className="mt-1 size-5 accent-[var(--primary)]" />
                <label htmlFor={`svc-${k}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="flex items-center gap-2 font-medium">
                    {INFO[k].label}
                    {services[k]
                      ? <span className="inline-flex items-center gap-1 text-xs font-normal text-success"><CheckCircle2 className="size-3.5" aria-hidden /> on</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 text-xs font-normal text-amber-800"><PauseCircle className="size-3.5" aria-hidden /> paused</span>}
                  </span>
                  <span className="block text-sm text-muted-foreground">When paused: {INFO[k].off}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Message to customers (English, optional)" htmlFor="note_en" hint="Shown with “temporarily unavailable”, e.g. “Back on Monday.”">
              <input id="note_en" name="note_en" maxLength={300} defaultValue={services.note.en} className={fieldClass} />
            </Field>
            <Field label="Message to customers (Amharic, optional)" htmlFor="note_am">
              <input id="note_am" name="note_am" maxLength={300} defaultValue={services.note.am} lang="am" className={fieldClass} />
            </Field>
          </div>
        </ActionForm>
        <p className="mt-4 text-sm text-muted-foreground">
          Home delivery and pickup have their own switches: <Link href="/admin/settings?tab=delivery" className="text-primary underline">Settings → Delivery</Link>.
        </p>
      </Panel>
    </>
  );
}
