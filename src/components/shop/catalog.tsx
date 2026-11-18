import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCategories, listProducts, type Department } from "@/lib/catalog/queries";
import { first, parsePage, parseSlug, parseSort, sanitizeSearchTerm } from "@/lib/catalog/search";
import { localized, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { ProductGrid } from "./product-card";
import { SortSelect } from "./sort-select";

type SearchParams = Record<string, string | string[] | undefined>;

function href(base: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** Shared catalog for /shop, /cosmetics and /electronics. All state lives in the URL. */
export async function Catalog({
  basePath,
  title,
  description,
  department,
  searchParams,
}: {
  basePath: string;
  title: string;
  description?: string;
  department?: Department;
  searchParams: SearchParams;
}) {
  const [t, locale, categories] = await Promise.all([getTranslations("catalog"), getLocale() as Promise<Locale>, getCategories()]);
  const q = sanitizeSearchTerm(first(searchParams.q));
  const sort = parseSort(first(searchParams.sort));
  const page = parsePage(first(searchParams.page));
  const categorySlug = parseSlug(first(searchParams.category));
  const inStock = first(searchParams.stock) === "1";

  const subcategories = categories.filter(
    (c) => c.parent_id !== null && c.department !== "printing" && (!department || c.department === department),
  );
  const activeCategory = subcategories.find((c) => c.slug === categorySlug) ?? null;

  const { products, total, pageCount } = await listProducts({
    department,
    categorySlug: activeCategory?.slug ?? null,
    search: q,
    sort,
    page,
    inStockOnly: inStock,
  });

  const keep = { q: q || undefined, sort: sort !== "newest" ? sort : undefined, stock: inStock ? "1" : undefined };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
        {q && <p className="text-sm text-muted-foreground">{t("searchResultsFor", { query: q })}</p>}
      </header>

      {subcategories.length > 0 && (
        <nav aria-label={t("categories")} className="-mx-4 mb-5 overflow-x-auto px-4">
          <ul className="flex w-max gap-2 pb-1">
            <li>
              <Link
                href={href(basePath, keep)}
                aria-current={!activeCategory ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
                  !activeCategory ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary",
                )}
              >
                {t("all")}
              </Link>
            </li>
            {subcategories.map((c) => {
              const active = c.slug === activeCategory?.slug;
              return (
                <li key={c.id}>
                  <Link
                    href={href(basePath, { ...keep, category: c.slug })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
                      active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary",
                    )}
                  >
                    {localized(c, "name", locale)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <form action={basePath} method="get" className="mb-6 flex flex-wrap items-center justify-between gap-3 border-y py-3">
        {q && <input type="hidden" name="q" value={q} />}
        {activeCategory && <input type="hidden" name="category" value={activeCategory.slug} />}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("results", { count: total })}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="stock" value="1" defaultChecked={inStock} className="size-4 accent-[var(--primary)]" />
            {t("inStockOnly")}
          </label>
          <SortSelect value={sort} />
          <noscript>
            <Button type="submit" size="sm" variant="outline">
              {t("apply")}
            </Button>
          </noscript>
        </div>
      </form>

      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <SearchX className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">{t("noResults")}</p>
          <Button variant="outline" asChild>
            <Link href={basePath}>{t("clearFilters")}</Link>
          </Button>
        </div>
      ) : (
        <ProductGrid products={products} priorityCount={4} />
      )}

      {pageCount > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
          <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
            {page > 1 ? (
              <Link href={href(basePath, { ...keep, category: activeCategory?.slug, page: String(page - 1) })} rel="prev">
                {t("previous")}
              </Link>
            ) : (
              <span>{t("previous")}</span>
            )}
          </Button>
          <span className="text-sm text-muted-foreground">{t("pageOf", { page, total: pageCount })}</span>
          <Button variant="outline" size="sm" asChild={page < pageCount} disabled={page >= pageCount}>
            {page < pageCount ? (
              <Link href={href(basePath, { ...keep, category: activeCategory?.slug, page: String(page + 1) })} rel="next">
                {t("next")}
              </Link>
            ) : (
              <span>{t("next")}</span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}
