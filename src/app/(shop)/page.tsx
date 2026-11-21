import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, BadgeCheck, Printer, ShieldCheck, Smartphone, Sparkles, Truck } from "lucide-react";
import { ProductGrid } from "@/components/shop/product-card";
import { Button } from "@/components/ui/button";
import { getFeaturedProducts, getHomepageBanners, getHomepagePromotions, getOnSaleProducts } from "@/lib/catalog/queries";
import { getSiteSettings } from "@/lib/catalog/settings";
import { formatETB, toSantim } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";
import { formatEthiopianPhone, normalizeEthiopianPhone } from "@/lib/validation/phone";
import { localized, type Locale } from "@/i18n/config";

function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {linkLabel} <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

const WHY_ICONS = [BadgeCheck, ShieldCheck, Truck];

export default async function HomePage() {
  const [s, t, locale, featured, onSale, banners, promotions] = await Promise.all([
    getSiteSettings(),
    getTranslations(),
    getLocale() as Promise<Locale>,
    getFeaturedProducts(8),
    getOnSaleProducts(4),
    getHomepageBanners(),
    getHomepagePromotions(),
  ]);
  const pick = (v: { en: string; am: string }) => v[locale] || v.en;
  const heroImage = publicImageUrl("site-assets", s.homepage.hero_image_path);
  const phone = normalizeEthiopianPhone(s.contact.phone);

  const departments = [
    { key: "cosmetics", href: "/cosmetics", icon: Sparkles, text: t("home.cosmeticsText"), tone: "bg-cosmetics/10 text-cosmetics" },
    { key: "electronics", href: "/electronics", icon: Smartphone, text: t("home.electronicsText"), tone: "bg-electronics/10 text-electronics" },
    { key: "printing", href: "/printing", icon: Printer, text: t("home.printingText"), tone: "bg-printing/10 text-printing" },
  ] as const;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-sidebar text-sidebar-foreground">
        {heroImage && <Image src={heroImage} alt="" fill priority sizes="100vw" className="object-cover opacity-35" />}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(0.8_0.12_82/0.25),transparent_60%)]" aria-hidden />
        <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-4 py-10 sm:gap-6 sm:py-24">
          <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">{pick(s.homepage.hero_title)}</h1>
          <p className="max-w-2xl text-base opacity-85 sm:text-lg">{pick(s.homepage.hero_subtitle)}</p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" variant="accent" asChild>
              <Link href="/shop">
                {t("home.shopNow")} <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground" asChild>
              <Link href="/printing">{t("nav.printing")}</Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl space-y-14 px-4 py-12">
        {/* Shop by category: departments, then their sub-categories */}
        <section aria-labelledby="home-categories" className="-mt-4 sm:mt-0">
          <h2 id="home-categories" className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">{t("home.departments")}</h2>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {departments.map((d) => (
              <Link key={d.key} href={d.href}
                className="group flex flex-col items-center gap-2 rounded-2xl border bg-card p-3 text-center shadow-xs transition-shadow hover:shadow-md sm:flex-row sm:items-start sm:gap-4 sm:p-5 sm:text-left">
                <span className={`inline-flex size-12 shrink-0 items-center justify-center rounded-xl ${d.tone}`}>
                  <d.icon className="size-6" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold sm:text-lg">{t(`nav.${d.key}`)}</span>
                  <span className="mt-1 hidden text-sm text-muted-foreground sm:block">{d.text}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Promotional banners (admin-managed) */}
        {banners.length > 0 && (
          <section aria-label={t("home.offers")} className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2">
            {banners.map((b) => {
              const img = publicImageUrl("site-assets", b.image_path);
              const content = (
                <div className="relative aspect-[16/7] w-[85vw] max-w-3xl shrink-0 snap-start overflow-hidden rounded-2xl bg-muted sm:w-[60vw]">
                  {img && <Image src={img} alt="" fill sizes="(min-width: 640px) 60vw, 85vw" className="object-cover" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-0 p-5 text-white">
                    <p className="text-lg font-semibold sm:text-2xl">{localized(b, "title", locale)}</p>
                    <p className="text-sm opacity-90">{localized(b, "subtitle", locale)}</p>
                  </div>
                </div>
              );
              return b.link_href ? (
                <Link key={b.id} href={b.link_href}>
                  {content}
                </Link>
              ) : (
                <div key={b.id}>{content}</div>
              );
            })}
          </section>
        )}

        {featured.length > 0 && (
          <section>
            <SectionHeader title={t("home.featured")} href="/shop" linkLabel={t("common.viewAll")} />
            <ProductGrid products={featured} />
          </section>
        )}

        {(onSale.length > 0 || promotions.length > 0) && (
          <section>
            <SectionHeader title={t("home.offers")} href="/shop?sort=price_asc" linkLabel={t("common.viewAll")} />
            {promotions.length > 0 && (
              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                {promotions.map((p) => (
                  <div key={p.id} className="rounded-xl border border-accent/40 bg-accent/10 p-4">
                    <p className="font-semibold">{localized(p, "title", locale)}</p>
                    <p className="text-sm text-muted-foreground">{localized(p, "description", locale)}</p>
                    <p className="mt-2 text-sm font-medium">
                      {p.discount_type === "percent"
                        ? t("home.percentOff", { value: p.discount_value })
                        : t("home.amountOff", { amount: formatETB(toSantim(p.discount_value), locale) })}
                      {p.code && <> · {t("home.code", { code: p.code })}</>}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {onSale.length > 0 && <ProductGrid products={onSale} />}
          </section>
        )}

        {/* Printing call-out */}
        <section className="grid items-center gap-6 overflow-hidden rounded-2xl border bg-printing/8 p-6 sm:grid-cols-[1fr_auto] sm:p-10">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold sm:text-2xl">{t("home.printingCta")}</h2>
            <p className="max-w-xl text-muted-foreground">{t("home.printingText")}</p>
          </div>
          <Button size="lg" asChild>
            <Link href="/printing">
              <Printer /> {t("home.seePrices")}
            </Link>
          </Button>
        </section>

        {s.homepage.why_us.length > 0 && (
          <section>
            <SectionHeader title={t("home.whyUs")} />
            <ul className="grid gap-4 sm:grid-cols-3">
              {s.homepage.why_us.map((item, i) => {
                const Icon = WHY_ICONS[i % WHY_ICONS.length];
                return (
                  <li key={i} className="flex items-center gap-3 rounded-xl border bg-card p-5">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="font-medium">{pick(item)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border bg-card p-6 sm:p-8">
          <SectionHeader title={t("home.visitUs")} href="/contact" linkLabel={t("nav.contact")} />
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            {phone && (
              <div>
                <dt className="text-muted-foreground">{t("pages.phone")}</dt>
                <dd className="font-medium"><a href={`tel:${phone}`}>{formatEthiopianPhone(phone)}</a></dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">{t("pages.address")}</dt>
              <dd className="font-medium">{pick(s.contact.address)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("footer.hours")}</dt>
              <dd className="font-medium">{pick(s.hours)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
