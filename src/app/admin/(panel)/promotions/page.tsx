import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { BannerForm } from "@/components/admin/banner-form";
import { Field, Frame, PageHeader, Panel, SubTabs, fieldClass, pickTab } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { assignPromotion, deleteBanner, deletePromotion, savePromotion, unassignPromotion } from "@/lib/admin/promotion-actions";
import { requirePermission } from "@/lib/auth/guards";
import { formatDateTime, toZoneInput } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Promotions" };

type Promo = {
  id: string; title_en: string; title_am: string; description_en: string; description_am: string; code: string | null;
  discount_type: string; discount_value: number; min_order_etb: number; category_id: string | null; product_id: string | null;
  starts_at: string | null; ends_at: string | null; max_redemptions: number | null; once_per_customer: boolean;
  is_active: boolean; show_on_homepage: boolean; restricted: boolean;
};
type Option = { id: string; name: string };

function PromotionFields({ p, categories, products }: { p?: Promo; categories: Option[]; products: Option[] }) {
  const id = p?.id ?? "new";
  const scope = p?.product_id ? "product" : p?.category_id ? "category" : "all";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Title" htmlFor={`pt-en-${id}`}><input id={`pt-en-${id}`} name="title_en" required maxLength={120} defaultValue={p?.title_en} className={fieldClass} /></Field>
      <Field label="Promo code" htmlFor={`pc-${id}`} hint="Customers type this at checkout. Empty = announcement only.">
        <input id={`pc-${id}`} name="code" maxLength={30} defaultValue={p?.code ?? ""} placeholder="e.g. WELCOME10" className={`${fieldClass} uppercase`} />
      </Field>
      <Field label="Description" htmlFor={`pd-en-${id}`} className="sm:col-span-2 lg:col-span-1"><input id={`pd-en-${id}`} name="description_en" maxLength={500} defaultValue={p?.description_en} className={fieldClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Discount" htmlFor={`pdt-${id}`}>
          <select id={`pdt-${id}`} name="discount_type" defaultValue={p?.discount_type ?? "percent"} className={fieldClass}>
            <option value="percent">% off</option><option value="fixed">ETB off</option>
          </select>
        </Field>
        <Field label="Amount" htmlFor={`pdv-${id}`}><input id={`pdv-${id}`} name="discount_value" type="number" required min={0.01} step="0.01" defaultValue={p?.discount_value} className={fieldClass} /></Field>
      </div>
      <Field label="Applies to" htmlFor={`ps-${id}`}>
        <select id={`ps-${id}`} name="scope" defaultValue={scope} className={fieldClass}>
          <option value="all">All products</option><option value="category">One category</option><option value="product">One product</option>
        </select>
      </Field>
      <Field label="Category (if “one category”)" htmlFor={`pcat-${id}`}>
        <select id={`pcat-${id}`} name="category_id" defaultValue={p?.category_id ?? ""} className={fieldClass}>
          <option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Product (if “one product”)" htmlFor={`pprod-${id}`}>
        <select id={`pprod-${id}`} name="product_id" defaultValue={p?.product_id ?? ""} className={fieldClass}>
          <option value="">—</option>{products.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Minimum order (ETB)" htmlFor={`pmin-${id}`} hint="Basket subtotal before delivery"><input id={`pmin-${id}`} name="min_order_etb" type="number" min={0} step="0.01" defaultValue={p?.min_order_etb ?? 0} className={fieldClass} /></Field>
      <Field label="Usage limit (optional)" htmlFor={`pmax-${id}`} hint="Total orders that can use the code"><input id={`pmax-${id}`} name="max_redemptions" type="number" min={1} defaultValue={p?.max_redemptions ?? ""} className={fieldClass} /></Field>
      <Field label="Starts (optional)" htmlFor={`pst-${id}`}><input id={`pst-${id}`} name="starts_at" type="datetime-local" defaultValue={toZoneInput(p?.starts_at)} className={fieldClass} /></Field>
      <Field label="Ends (optional)" htmlFor={`pen-${id}`}><input id={`pen-${id}`} name="ends_at" type="datetime-local" defaultValue={toZoneInput(p?.ends_at)} className={fieldClass} /></Field>
      <div className="space-y-2 text-sm sm:col-span-2 lg:col-span-3">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={p?.is_active ?? true} className="size-4 accent-[var(--primary)]" /> Active</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="once_per_customer" defaultChecked={p?.once_per_customer ?? true} className="size-4 accent-[var(--primary)]" /> One use per customer account</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="restricted" defaultChecked={p?.restricted ?? false} className="size-4 accent-[var(--primary)]" /> Only for selected customers (personal code — choose the customers after saving)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="show_on_homepage" defaultChecked={p?.show_on_homepage ?? false} className="size-4 accent-[var(--primary)]" /> Show on the homepage (makes the code public)</label>
      </div>
    </div>
  );
}

function timeWindow(start: string | null, end: string | null) {
  if (!start && !end) return "Always";
  return `${start ? formatDateTime(start, "en") : "now"} → ${end ? formatDateTime(end, "en") : "no end"}`;
}

export default async function PromotionsPage({ searchParams }: PageProps<"/admin/promotions">) {
  await requirePermission("promotions.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: promos }, { data: banners }, { data: cats }, { data: prods }, { data: used }, { data: holders }] = await Promise.all([
    supabase.from("promotions").select("*").order("created_at", { ascending: false }),
    supabase.from("homepage_banners").select("*").order("sort_order"),
    supabase.from("categories").select("id, name_en, parent_id").order("sort_order"),
    supabase.from("products").select("id, name_en, sku").neq("status", "archived").order("name_en").limit(1000),
    supabase.from("orders").select("promotion_id, status").not("promotion_id", "is", null).limit(10000),
    supabase.rpc("admin_promotion_customers", {}),
  ]);
  const holdersOf = (id: string) => (holders ?? []).filter((h) => h.promotion_id === id);
  const categories: Option[] = (cats ?? []).map((c) => ({ id: c.id, name: c.parent_id ? `— ${c.name_en}` : c.name_en }));
  const products: Option[] = (prods ?? []).map((p) => ({ id: p.id, name: `${p.name_en} (${p.sku})` }));
  const uses = new Map<string, number>();
  for (const o of used ?? []) if (o.promotion_id && !["expired", "cancelled"].includes(o.status)) uses.set(o.promotion_id, (uses.get(o.promotion_id) ?? 0) + 1);
  const now = new Date().getTime();
  const live = (p: { is_active: boolean; starts_at: string | null; ends_at: string | null }) =>
    p.is_active && (!p.starts_at || Date.parse(p.starts_at) <= now) && (!p.ends_at || Date.parse(p.ends_at) > now);
  const nameOf = (list: Option[], id: string | null) => list.find((x) => x.id === id)?.name.replace(/^— /, "") ?? "—";

  const TABS = [
    { key: "codes", label: "Promotions", count: (promos ?? []).length },
    { key: "new", label: "New promotion" },
    { key: "banners", label: "Homepage banners", count: (banners ?? []).length },
    { key: "new-banner", label: "New banner" },
  ];
  const tab = pickTab(TABS, (await searchParams).tab);

  return (
    <>
      <PageHeader title="Promotions & banners" description="Promo codes customers can use at checkout, offers on the homepage, and homepage banners. Times are Warsaw time." />

      <SubTabs base="/admin/promotions" tabs={TABS} active={tab} />
      {tab === "new" && (
        <Panel title="New promotion">
          <div><ActionForm action={savePromotion} hidden={{ id: "" }} submitLabel="Create promotion" resetOnSuccess><PromotionFields categories={categories} products={products} /></ActionForm></div>
        </Panel>
      )}
      {tab === "codes" && (
      <section className="space-y-4">
        {(promos ?? []).length === 0 && <p className="text-sm text-muted-foreground">No promotions yet.</p>}
        <Frame search="Search promotions (title, code, customer)…" className="p-2">
        <ul className="space-y-3">
          {((promos ?? []) as Promo[]).map((p) => (
            <li key={p.id} data-row className="rounded-lg border bg-card p-4">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <span className="font-medium">{p.title_en}</span>
                  {p.code && <Badge variant="outline" className="font-mono">{p.code}</Badge>}
                  <span className="text-sm text-muted-foreground">
                    {p.discount_type === "percent" ? `${p.discount_value}% off` : `${formatETB(toSantim(p.discount_value))} off`}
                    {" · "}{p.product_id ? nameOf(products, p.product_id) : p.category_id ? nameOf(categories, p.category_id) : "all products"}
                    {Number(p.min_order_etb) > 0 && ` · min ${formatETB(toSantim(p.min_order_etb))}`}
                    {" · "}used {uses.get(p.id) ?? 0}{p.max_redemptions ? ` / ${p.max_redemptions}` : ""}
                  </span>
                  {live(p) ? <Badge variant="success">Live</Badge> : <Badge variant="secondary">{p.is_active ? "Scheduled / ended" : "Off"}</Badge>}
                  {p.show_on_homepage && <Badge variant="info">Homepage</Badge>}
                  {p.restricted && <Badge variant="accent">Personal · {holdersOf(p.id).length} customer(s)</Badge>}
                  <span className="ml-auto text-xs text-primary">Edit</span>
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">{timeWindow(p.starts_at, p.ends_at)}</p>
                <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
                  <ActionForm action={savePromotion} hidden={{ id: p.id }} submitLabel="Save"><PromotionFields p={p} categories={categories} products={products} /></ActionForm>
                  {p.restricted && (
                    <div className="space-y-3 rounded-lg border bg-card p-3">
                      <p className="text-sm font-medium">Customers who can use {p.code}</p>
                      {holdersOf(p.id).length === 0 ? <p className="text-sm text-muted-foreground">Nobody yet.</p> : (
                        <ul className="divide-y text-sm">
                          {holdersOf(p.id).map((h) => (
                            <li key={h.user_id} className="flex flex-wrap items-center gap-2 py-2">
                              <Link href={`/admin/customers/${h.user_id}`} className="text-primary underline underline-offset-2">{h.full_name || h.email}</Link>
                              <span className="text-xs break-all text-muted-foreground">{h.email}</span>
                              {h.used && <Badge variant="success">used</Badge>}
                              <ActionForm action={unassignPromotion} hidden={{ promotionId: p.id, userId: h.user_id }} submitLabel="Remove" variant="outline" size="sm" className="ml-auto space-y-0" />
                            </li>
                          ))}
                        </ul>
                      )}
                      <ActionForm action={assignPromotion} hidden={{ promotionId: p.id }} submitLabel="Give code" size="sm" resetOnSuccess keepSuccess>
                        <Field label="Add customers by email" htmlFor={`pe-${p.id}`} hint="One per line, or separated by commas. They must have an account. They will see the code under “My account”.">
                          <textarea id={`pe-${p.id}`} name="emails" rows={2} className={fieldClass} placeholder="customer@gmail.com" />
                        </Field>
                        <input name="note" maxLength={300} placeholder="Personal message (optional)" aria-label="Personal message" className={`${fieldClass} h-8`} />
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="notify" defaultChecked className="size-4 accent-[var(--primary)]" /> Send the code to each customer (email + phone notification)</label>
                      </ActionForm>
                    </div>
                  )}
                  <ActionForm action={deletePromotion} hidden={{ id: p.id }} submitLabel="Delete" variant="outline" size="sm" confirm={`Delete “${p.title_en}”?`} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        </Frame>
        <p className="text-xs text-muted-foreground">
          The discount is calculated by the system at checkout from current prices (never by the customer’s browser). Printing jobs are not discounted.
          For a simple price cut on one product, you can also set a sale price on the product.
        </p>
      </section>
      )}

      {tab === "new-banner" && <Panel title="New banner"><BannerForm /></Panel>}
      {tab === "banners" && (
      <section className="space-y-4">
        {(banners ?? []).length === 0 && <p className="text-sm text-muted-foreground">No banners yet.</p>}
        <ul className="grid gap-4 lg:grid-cols-2">
          {(banners ?? []).map((b) => {
            const img = publicImageUrl("site-assets", b.image_path);
            return (
              <li key={b.id} className="overflow-hidden rounded-lg border bg-card">
                <div className="relative aspect-[16/7] bg-muted">
                  {img && <Image src={img} alt="" fill sizes="(min-width: 1024px) 40vw, 90vw" className="object-cover" />}
                </div>
                <div className="space-y-2 p-4">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{b.title_en}</span>
                    {live(b) ? <Badge variant="success">Showing</Badge> : <Badge variant="secondary">{b.is_active ? "Scheduled / ended" : "Hidden"}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">{timeWindow(b.starts_at, b.ends_at)}{b.link_href ? ` · links to ${b.link_href}` : ""} · order {b.sort_order}</p>
                  <details>
                    <summary className="cursor-pointer text-sm text-primary">Edit</summary>
                    <div className="mt-3 space-y-3">
                      <BannerForm b={{ ...b, starts: toZoneInput(b.starts_at), ends: toZoneInput(b.ends_at) }} />
                      <ActionForm action={deleteBanner} hidden={{ id: b.id }} submitLabel="Delete banner" variant="outline" size="sm" confirm="Delete this banner?" />
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      )}
    </>
  );
}
