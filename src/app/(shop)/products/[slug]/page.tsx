import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, PackageCheck, PackageX } from "lucide-react";
import { AddToCart } from "@/components/shop/add-to-cart";
import { NotifyMe } from "@/components/shop/notify-me";
import { ReviewBox } from "@/components/shop/review-box";
import { Stars } from "@/components/shop/stars";
import { getProductReviews, getRatings } from "@/lib/catalog/reviews";
import { formatDate } from "@/lib/datetime";
import { discountPercent, Price } from "@/components/shop/price";
import { LOW_STOCK, ProductGrid } from "@/components/shop/product-card";
import { ProductGallery } from "@/components/shop/product-gallery";
import { Badge } from "@/components/ui/badge";
import { getProductBySlug, getRelatedProducts } from "@/lib/catalog/queries";
import { parseSlug } from "@/lib/catalog/search";
import { publicImageUrl } from "@/lib/storage";
import { localized, type Locale } from "@/i18n/config";

async function load(params: Promise<{ slug: string }>) {
  const slug = parseSlug((await params).slug);
  return slug ? getProductBySlug(slug) : null;
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const [product, locale] = await Promise.all([load(params), getLocale() as Promise<Locale>]);
  if (!product) return {};
  const description = localized(product, "description", locale).slice(0, 160);
  const image = publicImageUrl("product-images", product.images[0]?.storage_path);
  return {
    title: localized(product, "name", locale),
    description,
    openGraph: { title: localized(product, "name", locale), description, images: image ? [image] : undefined },
  };
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const [product, t, locale] = await Promise.all([load(params), getTranslations(), getLocale() as Promise<Locale>]);
  if (!product) notFound();

  const name = localized(product, "name", locale);
  const description = localized(product, "description", locale);
  const available = product.track_inventory ? product.stock_quantity : null;
  const pct = discountPercent(product.price_etb, product.sale_price_etb);
  const [related, ratings, reviews] = await Promise.all([getRelatedProducts(product), getRatings([product.id]), getProductReviews(product.id)]);
  const rating = ratings.get(product.id);
  const dept = product.category.department;
  const images = product.images.map((img) => ({
    url: publicImageUrl("product-images", img.storage_path)!,
    alt: localized(img, "alt", locale) || name,
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    sku: product.sku,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: images.map((i) => i.url),
    description,
    offers: {
      "@type": "Offer",
      priceCurrency: "ETB",
      price: product.effective_price_etb,
      availability: available === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
    aggregateRating: rating ? { "@type": "AggregateRating", ratingValue: rating.avg, reviewCount: rating.count } : undefined,
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1">
          <li><Link href="/" className="hover:text-foreground">{t("product.home")}</Link></li>
          <ChevronRight className="size-3.5" aria-hidden />
          <li><Link href={`/${dept}`} className="hover:text-foreground">{t(`nav.${dept}`)}</Link></li>
          <ChevronRight className="size-3.5" aria-hidden />
          <li>
            <Link href={`/${dept}?category=${product.category.slug}`} className="hover:text-foreground">
              {localized(product.category, "name", locale)}
            </Link>
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ProductGallery images={images} alt={name} department={dept} />

        <div className="flex flex-col gap-5">
          <div className="space-y-2">
            {product.brand && <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{product.brand}</p>}
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{name}</h1>
            {rating && (
              <a href="#reviews" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <Stars value={rating.avg} size="md" label={t("reviews.ratingLabel", { rating: rating.avg.toFixed(1) })} />
                <span>{rating.avg.toFixed(1)} · {t("reviews.count", { count: rating.count })}</span>
              </a>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Price price={product.price_etb} salePrice={product.sale_price_etb} locale={locale} size="lg" />
            {pct && <Badge variant="destructive">{t("product.save", { percent: pct })}</Badge>}
          </div>

          <p className="flex items-center gap-2 text-sm font-medium">
            {available === 0 ? (
              <><PackageX className="size-4 text-destructive" aria-hidden /> <span className="text-destructive">{t("common.outOfStock")}</span></>
            ) : available !== null && available <= LOW_STOCK ? (
              <><PackageCheck className="size-4 text-amber-700" aria-hidden /> <span className="text-amber-700">{t("common.lowStock", { count: available })}</span></>
            ) : (
              <><PackageCheck className="size-4 text-success" aria-hidden /> <span className="text-success">{t("common.inStock")}</span></>
            )}
          </p>

          {available === 0 ? <NotifyMe productId={product.id} slug={product.slug} /> : <AddToCart productId={product.id} available={available} showQuantity />}

          {description && (
            <section className="space-y-2 border-t pt-5">
              <h2 className="font-semibold">{t("product.description")}</h2>
              <p className="whitespace-pre-line text-muted-foreground">{description}</p>
            </section>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border-t pt-5 text-sm">
            <dt className="text-muted-foreground">{t("product.sku")}</dt>
            <dd>{product.sku}</dd>
            {product.brand && (
              <>
                <dt className="text-muted-foreground">{t("product.brand")}</dt>
                <dd>{product.brand}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <section id="reviews" className="mt-12 scroll-mt-24 border-t pt-8">
        <h2 className="mb-1 text-xl font-semibold">{t("reviews.title")}</h2>
        {rating && <p className="mb-5 text-sm text-muted-foreground">{rating.avg.toFixed(1)} / 5 · {t("reviews.count", { count: rating.count })}</p>}
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div>
            {reviews.length === 0 ? <p className="text-sm text-muted-foreground">{t("reviews.none")}</p> : (
              <ul className="divide-y">
                {reviews.map((r) => (
                  <li key={r.id} className="space-y-1.5 py-4 first:pt-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Stars value={r.rating} label={t("reviews.ratingLabel", { rating: r.rating })} />
                      <span className="text-sm font-medium">{r.display_name}</span>
                      <span className="text-xs text-success">{t("reviews.verified")}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(r.created_at, locale)}</span>
                    </div>
                    {r.body && <p className="text-sm whitespace-pre-line">{r.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ReviewBox productId={product.id} />
        </div>
      </section>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-5 text-xl font-semibold">{t("product.related")}</h2>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
