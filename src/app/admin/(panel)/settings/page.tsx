import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { BrandImage } from "@/components/admin/brand-image";
import { Field, PageHeader, Panel, SubTabs } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveBankAccount, saveDeliveryDiscounts, saveDeliveryZone, saveSettings } from "@/lib/admin/settings-actions";
import { requirePermission } from "@/lib/auth/guards";
import { getSiteSettings } from "@/lib/catalog/settings";
import { first } from "@/lib/catalog/search";
import { publicImageUrl } from "@/lib/storage";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

function Bilingual({ name, label, en, area }: { name: string; label: string; en?: string; am?: string; area?: boolean }) {
  const C = area ? Textarea : Input;
  return (
    <Field label={label}><C name={`${name}_en`} defaultValue={en} maxLength={500} /></Field>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const ctx = await requirePermission("settings.manage", "bank_accounts.manage");
  const canSettings = ctx.permissions.has("settings.manage");
  const canBanks = ctx.permissions.has("bank_accounts.manage");
  const tabs = [
    ...(canSettings ? [{ k: "general", l: "Business" }, { k: "contact", l: "Contact & hours" }, { k: "social", l: "Social media" },
      { k: "homepage", l: "Homepage" }, { k: "about", l: "About us" }, { k: "delivery", l: "Delivery" }] : []),
    ...(canBanks ? [{ k: "banks", l: "Bank accounts" }] : []),
    ...(canSettings ? [{ k: "legal", l: "Terms & privacy" }, { k: "printing", l: "Printing" }] : []),
  ];
  const requested = first((await searchParams).tab);
  const tab = tabs.find((t) => t.k === requested)?.k ?? tabs[0].k;
  const s = await getSiteSettings();
  const supabase = await createSupabaseServerClient();

  return (
    <>
      <PageHeader title="Settings" description="Changes go live on the website immediately." />
      <SubTabs base="/admin/settings" tabs={tabs.map((t) => ({ key: t.k, label: t.l }))} active={tab} />

      {tab === "general" && (
        <div className="space-y-6">
          <Panel title="Business">
            <div className="space-y-5">
              <BrandImage slot="logo" label="Logo (shown in the header)" url={publicImageUrl("site-assets", s.business.logo_path)} />
              <BrandImage slot="appIcon" label="App icon (phone home screen and browser tab)"
                hint="Square PNG or JPG, at least 512×512 pixels, with your logo filling most of it. If empty, your logo is used on a white square."
                url={publicImageUrl("site-assets", s.business.app_icon_path)} />
              <ActionForm action={saveSettings} hidden={{ key: "business" }} submitLabel="Save business details">
                <Bilingual name="name" label="Business name" en={s.business.name.en} am={s.business.name.am} />
                <Bilingual name="tagline" label="Tagline" en={s.business.tagline.en} am={s.business.tagline.am} />
              </ActionForm>
            </div>
          </Panel>
        </div>
      )}
      {tab === "contact" && (
        <div className="space-y-6">
          <Panel title="Contact">
            <ActionForm action={saveSettings} hidden={{ key: "contact" }} submitLabel="Save contact details">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone"><Input name="phone" defaultValue={s.contact.phone} maxLength={30} /></Field>
                <Field label="Email (e.g. yourshop@gmail.com)"><Input name="email" type="email" defaultValue={s.contact.email ?? ""} maxLength={254} /></Field>
                <Field label="Telegram username" hint="Without @"><Input name="telegram" defaultValue={s.contact.telegram ?? ""} maxLength={100} /></Field>
                <Field label="WhatsApp number" hint="Ethiopian mobile number, e.g. 0911 22 33 44"><Input name="whatsapp" defaultValue={s.contact.whatsapp ?? ""} maxLength={30} /></Field>
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
        </div>
      )}
      {tab === "social" && (
        <div className="space-y-6">
          <Panel title="Social media">
            <ActionForm action={saveSettings} hidden={{ key: "social" }} submitLabel="Save links">
              <div className="grid gap-3 sm:grid-cols-2">
                {([["instagram", "Instagram", "https://instagram.com/yourshop"], ["tiktok", "TikTok", "https://www.tiktok.com/@yourshop"],
                  ["facebook", "Facebook", "https://facebook.com/yourshop"], ["telegram", "Telegram channel", "https://t.me/yourshop"]] as const).map(([n, label, ph]) => (
                  <Field key={n} label={`${label} link`}><Input name={n} type="url" placeholder={ph} defaultValue={s.social[n] ?? ""} /></Field>
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

      {tab === "about" && (
        <Panel title="About us page">
          <ActionForm action={saveSettings} hidden={{ key: "about" }} submitLabel="Save About us">
            <p className="text-sm text-muted-foreground">
              What customers see under <Link href="/about" className="text-primary underline" target="_blank">About us</Link>. Start a section with a line beginning{" "}
              <code className="rounded bg-muted px-1">## </code> (e.g. <code className="rounded bg-muted px-1">## Our story</code>); leave a blank line between paragraphs.
              <code className="rounded bg-muted px-1">{"{name}"}</code> is replaced with your business name. Leave the text empty to show the standard description.
            </p>
            <Field label="Page title (optional — default “About us”)"><Input name="title_en" defaultValue={s.about.title.en} maxLength={120} /></Field>
            <Field label="Text">
              <Textarea name="body_en" rows={14} maxLength={10000} defaultValue={s.about.body.en} placeholder={"## Our story\n{name} started in Addis Ababa in …\n\n## What we offer\n…"} data-testid="about-body" />
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="show_services" defaultChecked={s.about.show_services} className="size-4 accent-[var(--primary)]" /> Show our services (cosmetics, electronics, printing) below the text</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="show_why_us" defaultChecked={s.about.show_why_us} className="size-4 accent-[var(--primary)]" /> Show the “Why shop with us” points (from Homepage)</label>
          </ActionForm>
        </Panel>
      )}

      {tab === "legal" && (
        <Panel title="Terms & conditions and privacy policy">
          <ActionForm action={saveSettings} hidden={{ key: "legal" }} submitLabel="Save legal texts">
            <p className="text-sm text-muted-foreground">
              Start a section with a line beginning <code className="rounded bg-muted px-1">## </code> (e.g. <code className="rounded bg-muted px-1">## Payment</code>);
              leave a blank line between paragraphs. <code className="rounded bg-muted px-1">{"{name}"}</code> is replaced with your business name.
              Customers must accept the terms when they sign up and at checkout.
            </p>
            {(["terms", "privacy"] as const).map((doc) => (
              <div key={doc}>
                <Field label={doc === "terms" ? "Terms & conditions" : "Privacy policy"}>
                  <Textarea name={`${doc}_en`} rows={14} maxLength={30000} defaultValue={s.legal[doc].en} className="font-mono text-xs" />
                </Field>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="approved" defaultChecked={s.legal.approved} className="size-4 accent-[var(--primary)]" />
              Reviewed and approved for publication (removes the “Draft” notice on the website)
            </label>
          </ActionForm>
        </Panel>
      )}
      {tab === "delivery" && <DeliveryTab s={s} supabase={supabase} superAdmin={ctx.role === "super_admin"} />}
      {tab === "banks" && <BanksTab supabase={supabase} />}
      {tab === "printing" && (
        <Panel title="Printing service" className="max-w-2xl">
          <ActionForm action={saveSettings} hidden={{ key: "printing" }} submitLabel="Save printing settings">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Service charge per job (ETB)"><Input name="service_charge_etb" type="number" min={0} step="0.01" defaultValue={s.printing.service_charge_etb} /></Field>
              <Field label="Max file size (MB, ≤ 25)"><Input name="max_file_mb" type="number" min={1} max={25} defaultValue={s.printing.max_file_mb} /></Field>
              <Field label="Max copies per job"><Input name="max_copies" type="number" min={1} max={1000} defaultValue={s.printing.max_copies} /></Field>
              <Field label="Delete customer files after (days)" hint="Files are deleted as soon as a job is marked Completed (picked up); this is the latest they are kept otherwise."><Input name="retention_days" type="number" min={1} max={365} defaultValue={s.printing.retention_days} /></Field>
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
      <Field label="City" className="lg:col-span-2"><Input name="name_en" required defaultValue={z?.name_en} maxLength={80} /></Field>
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
        <Field label="Instructions"><Textarea name="instructions_en" rows={2} defaultValue={b?.instructions_en} maxLength={1000} /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Order shown"><Input name="sort_order" type="number" min={0} max={100} defaultValue={b?.sort_order ?? 0} className="w-24" /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={b?.is_active ?? true} className="size-4 accent-[var(--primary)]" /> Active</label>
      </div>
    </div>
  );
}


async function DeliveryTab({ s, supabase, superAdmin }: { s: Awaited<ReturnType<typeof getSiteSettings>>; supabase: Supa; superAdmin: boolean }) {
  const { data: zones } = await supabase.from("delivery_zones").select("*").order("sort_order");
  const steps = s.delivery.delivery_discounts ?? [];
  const on = (zones ?? []).filter((z) => z.is_active);
  const off = (zones ?? []).filter((z) => !z.is_active);
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
            <Field label="Payment window (minutes)" hint="Unpaid orders are released after this and their stock is free for the next buyer (first to pay gets it)"><Input name="payment_window_minutes" type="number" min={5} max={10080} required defaultValue={s.delivery.payment_window_minutes ?? 30} /></Field>
          </div>
        </ActionForm>
      </Panel>
      <Panel title="Delivery discount for more items">
        <p className="mb-3 text-sm text-muted-foreground">The more items in an order, the lower the delivery fee the customer pays (e.g. 3+ items 10 % off, 6+ items 25 % off). The courier still earns the city&apos;s full delivery price.</p>
        {superAdmin ? (
          <ActionForm action={saveDeliveryDiscounts} submitLabel="Save discounts" className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-16 text-muted-foreground">Step {i + 1}</span> from
                <Input name={`min_${i}`} type="number" min={2} max={1000} defaultValue={steps[i]?.min_items ?? ""} className="w-24" aria-label={`Step ${i + 1}: number of items`} /> items:
                <Input name={`pct_${i}`} type="number" min={1} max={100} step="0.5" defaultValue={steps[i]?.percent ?? ""} className="w-24" aria-label={`Step ${i + 1}: percent off`} /> % off delivery
              </div>
            ))}
          </ActionForm>
        ) : (
          <p className="text-sm">{steps.length ? steps.map((d) => `${d.min_items}+ items: ${d.percent}% off`).join(" · ") : "No discount steps."} <span className="text-muted-foreground">(set by the Super Admin)</span></p>
        )}
      </Panel>
      <Panel title="Delivery cities & fees">
        <p className="mb-2 text-sm text-muted-foreground">Customers can choose the active cities. The fee is the city&apos;s full delivery price (before the many-items discount) — it is also what the courier earns.</p>
        <ul className="divide-y">
          {on.map((z) => (
            <li key={z.id} className="py-3">
              <ActionForm action={saveDeliveryZone} hidden={{ id: z.id }} submitLabel="Save" size="sm" variant="outline"><ZoneFields z={z} /></ActionForm>
            </li>
          ))}
        </ul>
        {off.length > 0 && (
          <details className="mt-3 rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Other Ethiopian cities — switched off ({off.length}): set a fee and tick “Active” to open one</summary>
            <ul className="mt-2 divide-y">
              {off.map((z) => (
                <li key={z.id} className="py-3">
                  <ActionForm action={saveDeliveryZone} hidden={{ id: z.id }} submitLabel="Save" size="sm" variant="outline"><ZoneFields z={z} /></ActionForm>
                </li>
              ))}
            </ul>
          </details>
        )}
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
