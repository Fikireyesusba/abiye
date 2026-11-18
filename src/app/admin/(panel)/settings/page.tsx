import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { BrandImage } from "@/components/admin/brand-image";
import { Field, PageHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveBankAccount, saveDeliveryZone, saveSettings } from "@/lib/admin/settings-actions";
import { requirePermission } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { first } from "@/lib/catalog/search";
import { publicImageUrl } from "@/lib/storage";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

function Bilingual({ name, label, en, am, area }: { name: string; label: string; en?: string; am?: string; area?: boolean }) {
  const C = area ? Textarea : Input;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={`${label} (English)`}><C name={`${name}_en`} defaultValue={en} maxLength={500} /></Field>
      <Field label={`${label} (Amharic)`}><C name={`${name}_am`} defaultValue={am} maxLength={500} lang="am" /></Field>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const ctx = await requirePermission("settings.manage", "bank_accounts.manage");
  const canSettings = ctx.permissions.has("settings.manage");
  const canBanks = ctx.permissions.has("bank_accounts.manage");
  const tabs = [
    ...(canSettings ? [{ k: "general", l: "Business & contact" }, { k: "homepage", l: "Homepage" }, { k: "delivery", l: "Delivery" }] : []),
    ...(canBanks ? [{ k: "banks", l: "Bank accounts" }] : []),
    ...(canSettings ? [{ k: "printing", l: "Printing" }] : []),
  ];
  const requested = first((await searchParams).tab);
  const tab = tabs.find((t) => t.k === requested)?.k ?? tabs[0].k;
  const s = await getSiteSettings();
  const supabase = await createSupabaseServerClient();

  return (
    <>
      <PageHeader title="Settings" description="Changes go live on the website immediately." />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Settings sections">
        {tabs.map((t) => (
          <Link key={t.k} href={`/admin/settings?tab=${t.k}`} aria-current={t.k === tab ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm whitespace-nowrap", t.k === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.l}</Link>
        ))}
      </nav>

      {tab === "general" && (
        <div className="space-y-6">
          <Panel title="Business">
            <div className="space-y-5">
              <BrandImage slot="logo" label="Logo (shown in the header)" url={publicImageUrl("site-assets", s.business.logo_path)} />
              <ActionForm action={saveSettings} hidden={{ key: "business" }} submitLabel="Save business details">
                <Bilingual name="name" label="Business name" en={s.business.name.en} am={s.business.name.am} />
                <Bilingual name="tagline" label="Tagline" en={s.business.tagline.en} am={s.business.tagline.am} />
              </ActionForm>
            </div>
          </Panel>
          <Panel title="Contact">
            <ActionForm action={saveSettings} hidden={{ key: "contact" }} submitLabel="Save contact details">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone"><Input name="phone" defaultValue={s.contact.phone} maxLength={30} /></Field>
                <Field label="Email"><Input name="email" type="email" defaultValue={s.contact.email ?? ""} maxLength={254} /></Field>
                <Field label="Telegram username" hint="Without @"><Input name="telegram" defaultValue={s.contact.telegram ?? ""} maxLength={100} /></Field>
                <Field label="WhatsApp number"><Input name="whatsapp" defaultValue={s.contact.whatsapp ?? ""} maxLength={30} /></Field>
              </div>
              <Bilingual name="address" label="Address" en={s.contact.address.en} am={s.contact.address.am} />
              <Field label="Map link (https)"><Input name="map_url" type="url" defaultValue={s.contact.map_url ?? ""} /></Field>
            </ActionForm>
          </Panel>
          <Panel title="Opening hours">
            <ActionForm action={saveSettings} hidden={{ key: "hours" }} submitLabel="Save opening hours">
              <Bilingual name="hours" label="Opening hours" en={s.hours.en} am={s.hours.am} />
            </ActionForm>
          </Panel>
          <Panel title="Social media">
            <ActionForm action={saveSettings} hidden={{ key: "social" }} submitLabel="Save links">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["facebook", "instagram", "tiktok", "telegram"] as const).map((n) => (
                  <Field key={n} label={`${n[0].toUpperCase()}${n.slice(1)} URL`}><Input name={n} type="url" placeholder="https://" defaultValue={s.social[n] ?? ""} /></Field>
                ))}
              </div>
            </ActionForm>
          </Panel>
        </div>
      )}

      {tab === "homepage" && (
        <Panel title="Homepage">
          <div className="space-y-5">
            <BrandImage slot="hero" label="Hero background image (optional)" url={publicImageUrl("site-assets", s.homepage.hero_image_path)} />
            <ActionForm action={saveSettings} hidden={{ key: "homepage" }} submitLabel="Save homepage">
              <Bilingual name="hero_title" label="Headline" en={s.homepage.hero_title.en} am={s.homepage.hero_title.am} />
              <Bilingual name="hero_subtitle" label="Sub-headline" en={s.homepage.hero_subtitle.en} am={s.homepage.hero_subtitle.am} area />
              <p className="pt-2 text-sm font-medium">“Why shop with us” points (up to 3)</p>
              {[0, 1, 2].map((i) => (
                <Bilingual key={i} name={`why_${i}`} label={`Point ${i + 1}`} en={s.homepage.why_us[i]?.en} am={s.homepage.why_us[i]?.am} />
              ))}
            </ActionForm>
            <p className="text-xs text-muted-foreground">Featured products: tick “Feature on homepage” on a product. Sale products appear under Special offers automatically.</p>
          </div>
        </Panel>
      )}

      {tab === "delivery" && <DeliveryTab s={s} supabase={supabase} />}
      {tab === "banks" && <BanksTab supabase={supabase} />}
      {tab === "printing" && (
        <Panel title="Printing service" className="max-w-2xl">
          <ActionForm action={saveSettings} hidden={{ key: "printing" }} submitLabel="Save printing settings">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Service charge per job (ETB)"><Input name="service_charge_etb" type="number" min={0} step="0.01" defaultValue={s.printing.service_charge_etb} /></Field>
              <Field label="Max file size (MB, ≤ 25)"><Input name="max_file_mb" type="number" min={1} max={25} defaultValue={s.printing.max_file_mb} /></Field>
              <Field label="Max copies per job"><Input name="max_copies" type="number" min={1} max={1000} defaultValue={s.printing.max_copies} /></Field>
              <Field label="Delete customer files after (days)"><Input name="retention_days" type="number" min={1} max={365} defaultValue={s.printing.retention_days} /></Field>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-muted-foreground">Per-page prices: <Link href="/admin/printing/prices" className="text-primary hover:underline">Printing → Price list</Link>.</p>
        </Panel>
      )}
    </>
  );
}

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Zone = Database["public"]["Tables"]["delivery_zones"]["Row"];
type Bank = Database["public"]["Tables"]["bank_accounts"]["Row"];

function ZoneFields({ z }: { z?: Zone }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Field label="City (English)" className="lg:col-span-2"><Input name="name_en" required defaultValue={z?.name_en} maxLength={80} /></Field>
      <Field label="City (Amharic)"><Input name="name_am" required defaultValue={z?.name_am} maxLength={80} lang="am" /></Field>
      <Field label="Fee (ETB)"><Input name="fee_etb" type="number" min={0} step="0.01" required defaultValue={z?.fee_etb} /></Field>
      <Field label="Estimate"><Input name="estimated_days" defaultValue={z?.estimated_days ?? ""} placeholder="1–2 days" maxLength={40} /></Field>
      <Field label="Order"><Input name="sort_order" type="number" min={0} defaultValue={z?.sort_order ?? 0} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={z?.is_active ?? true} className="size-4 accent-[var(--primary)]" /> Available</label>
    </div>
  );
}

function BankFields({ b }: { b?: Bank }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Bank"><Input name="bank_name" required defaultValue={b?.bank_name} maxLength={80} placeholder="Commercial Bank of Ethiopia" /></Field>
        <Field label="Account holder"><Input name="account_holder" required defaultValue={b?.account_holder} maxLength={120} /></Field>
        <Field label="Account number"><Input name="account_number" required defaultValue={b?.account_number} maxLength={30} inputMode="numeric" className="font-mono" /></Field>
        <Field label="Branch (optional)"><Input name="branch" defaultValue={b?.branch ?? ""} maxLength={80} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Instructions (English)"><Textarea name="instructions_en" rows={2} defaultValue={b?.instructions_en} maxLength={1000} /></Field>
        <Field label="Instructions (Amharic)"><Textarea name="instructions_am" rows={2} defaultValue={b?.instructions_am} maxLength={1000} lang="am" /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Order shown"><Input name="sort_order" type="number" min={0} max={100} defaultValue={b?.sort_order ?? 0} className="w-24" /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={b?.is_active ?? true} className="size-4 accent-[var(--primary)]" /> Active</label>
      </div>
    </div>
  );
}


async function DeliveryTab({ s, supabase }: { s: Awaited<ReturnType<typeof getSiteSettings>>; supabase: Supa }) {
  const { data: zones } = await supabase.from("delivery_zones").select("*").order("sort_order");
  return (
    <div className="space-y-6">
      <Panel title="Fulfillment & payment window">
        <ActionForm action={saveSettings} hidden={{ key: "delivery" }} submitLabel="Save">
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="delivery_enabled" defaultChecked={s.delivery.delivery_enabled} className="size-4 accent-[var(--primary)]" /> Home delivery available</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="pickup_enabled" defaultChecked={s.delivery.pickup_enabled} className="size-4 accent-[var(--primary)]" /> Shop pickup available</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Free delivery from (ETB)" hint="Empty = never free"><Input name="free_delivery_threshold_etb" type="number" min={0} step="0.01" defaultValue={s.delivery.free_delivery_threshold_etb ?? ""} /></Field>
            <Field label="Payment window (hours)" hint="Unpaid orders expire after this and stock is released"><Input name="payment_window_hours" type="number" min={1} max={168} required defaultValue={s.delivery.payment_window_hours} /></Field>
          </div>
        </ActionForm>
      </Panel>
      <Panel title="Delivery cities & fees">
        <ul className="divide-y">
          {(zones ?? []).map((z) => (
            <li key={z.id} className="py-3">
              <ActionForm action={saveDeliveryZone} hidden={{ id: z.id }} submitLabel="Save" size="sm" variant="outline"><ZoneFields z={z} /></ActionForm>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-lg bg-muted/40 p-3">
          <p className="mb-2 text-sm font-medium">Add a city</p>
          <ActionForm action={saveDeliveryZone} hidden={{ id: "" }} submitLabel="Add city" size="sm" resetOnSuccess><ZoneFields /></ActionForm>
        </div>
      </Panel>
    </div>
  );
}

async function BanksTab({ supabase }: { supabase: Supa }) {
  const { data: banks } = await supabase.from("bank_accounts").select("*").order("sort_order");
  return (
    <div className="space-y-6">
      <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
        Customers are shown the <strong>first active account</strong> (lowest “order shown”). Every change is recorded in the audit log.
        Existing orders keep the account details they were placed with.
      </p>
      {(banks ?? []).map((b) => (
        <Panel key={b.id} title={b.bank_name} actions={b.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}>
          <ActionForm action={saveBankAccount} hidden={{ id: b.id }} submitLabel="Save account" confirm="Customers will be asked to pay into this account. Save?"><BankFields b={b} /></ActionForm>
        </Panel>
      ))}
      <Panel title="Add bank account">
        <ActionForm action={saveBankAccount} hidden={{ id: "" }} submitLabel="Add account" resetOnSuccess><BankFields /></ActionForm>
      </Panel>
    </div>
  );
}
