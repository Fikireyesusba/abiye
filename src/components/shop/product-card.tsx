import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { ProductCardData } from "@/lib/catalog/queries";
import { getRatings, type Rating } from "@/lib/catalog/reviews";
import { Stars } from "./stars";
import { localized, type Locale } from "@/i18n/config";
import { publicImageUrl } from "@/lib/storage";
import { AddToCart } from "./add-to-cart";
import { discountPercent, Price } from "./price";
import { ProductImage } from "./product-image";

export const LOW_STOCK = 5;

export function ProductCard({ product, priority, rating }: { product: ProductCardData; priority?: boolean; rating?: Rating }) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const name = localized(product, "name", locale);
  const img = product.images[0];
  const available = product.track_inventory ? product.stock_quantity : null;
  const pct = discountPercent(product.price_etb, product.sale_price_etb);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
      <Link href={`/products/${product.slug}`} className="block focus-visible:outline-none" aria-label={name}>
        <ProductImage
          src={publicImageUrl("product-images", img?.storage_path)}
          alt={(img && localized(img, "alt", locale)) || name}
          department={product.category.department}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          priority={priority}
          className="transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </Link>
      <div className="pointer-events-none absolute top-2 left-2 flex flex-col gap-1">
        {pct && <Badge variant="destructive" className="bg-destructive text-white">-{pct}%</Badge>}
        {available === 0 && <Badge variant="secondary">{t("common.outOfStock")}</Badge>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">
          {localized(product.category, "name", locale)}
          {product.audience && <> · <span className="font-medium text-foreground/70">{t(`product.audienceTag_${product.audience}`)}</span></>}
        </p>
        <h3 className="line-clamp-2 text-sm leading-snug font-medium sm:text-base">
          <Link href={`/products/${product.slug}`} className="hover:text-primary">
            {name}
          </Link>
        </h3>
        {rating && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Stars value={rating.avg} label={t("reviews.ratingLabel", { rating: rating.avg.toFixed(1) })} />
            <span>({rating.count})</span>
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-1">
          <Price price={product.price_etb} salePrice={product.sale_price_etb} locale={locale} />
          {available !== null && available > 0 && available <= LOW_STOCK && (
            <span className="text-xs font-medium text-amber-700">
              {t("common.lowStock", { count: available })}
            </span>
          )}
        </div>
        <AddToCart productId={product.id} available={available} compact />
      </div>
    </article>
  );
}

export async function ProductGrid({ products, priorityCount = 0 }: { products: ProductCardData[]; priorityCount?: number }) {
  const ratings = await getRatings(products.map((p) => p.id));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} rating={ratings.get(p.id)} />
      ))}
    </div>
  );
}
