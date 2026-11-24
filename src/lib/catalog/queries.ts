import "server-only";
import { cache } from "react";
import { getSupabasePublic } from "@/lib/supabase/public";
import { PAGE_SIZE, searchFilter, type Sort } from "./search";

export type Department = "cosmetics" | "electronics" | "printing";
export type Audience = "women" | "men" | "unisex";

/** Columns anon may read (see column grants in migration 0008/0010). Never use select("*"). */
const PRODUCT_CARD = `
  id, slug, sku, name_en, name_am, brand, price_etb, sale_price_etb, effective_price_etb,
  stock_quantity, track_inventory, is_featured, created_at, audience,
  category:categories!inner ( id, slug, name_en, name_am, department, parent_id ),
  images:product_images ( storage_path, alt_en, alt_am, is_primary, sort_order )
`;

export interface ProductImage {
  storage_path: string;
  alt_en: string | null;
  alt_am: string | null;
  is_primary: boolean;
  sort_order: number;
}

export interface ProductCardData {
  id: string;
  slug: string;
  sku: string;
  name_en: string;
  name_am: string;
  brand: string | null;
  price_etb: number;
  sale_price_etb: number | null;
  effective_price_etb: number;
  stock_quantity: number;
  track_inventory: boolean;
  is_featured: boolean;
  created_at: string;
  audience: Audience | null;
  category: { id: string; slug: string; name_en: string; name_am: string; department: Department; parent_id: string | null };
  images: ProductImage[];
}

export interface ProductDetail extends ProductCardData {
  description_en: string;
  description_am: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  department: Department;
  slug: string;
  name_en: string;
  name_am: string;
  sort_order: number;
}

function sortImages<T extends { images: ProductImage[] }>(p: T): T {
  return {
    ...p,
    images: [...p.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order),
  };
}

export const getCategories = cache(async (): Promise<Category[]> => {
  const { data, error } = await getSupabasePublic()
    .from("categories")
    .select("id, parent_id, department, slug, name_en, name_am, sort_order")
    .order("sort_order");
  if (error) throw new Error(`categories: ${error.message}`);
  return data as Category[];
});

export interface ProductListQuery {
  department?: Department;
  categorySlug?: string | null;
  search?: string;
  sort?: Sort;
  page?: number;
  inStockOnly?: boolean;
  /** women / men: also includes unisex products. */
  audience?: "women" | "men" | null;
}

export async function listProducts(q: ProductListQuery): Promise<{ products: ProductCardData[]; total: number; pageCount: number }> {
  const page = q.page ?? 1;
  let query = getSupabasePublic()
    .from("products")
    .select(PRODUCT_CARD, { count: "exact" })
    .eq("status", "active");

  if (q.department) query = query.eq("category.department", q.department);
  if (q.categorySlug) query = query.eq("category.slug", q.categorySlug);
  if (q.inStockOnly) query = query.or("track_inventory.eq.false,stock_quantity.gt.0");
  if (q.audience) query = query.in("audience", [q.audience, "unisex"]);
  const filter = searchFilter(q.search ?? "");
  if (filter) query = query.or(filter);

  switch (q.sort) {
    case "price_asc":
      query = query.order("effective_price_etb", { ascending: true });
      break;
    case "price_desc":
      query = query.order("effective_price_etb", { ascending: false });
      break;
    case "name":
      query = query.order("name_en", { ascending: true });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }
  query = query.order("id").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`products: ${error.message}`);
  const total = count ?? 0;
  return {
    products: (data as unknown as ProductCardData[]).map(sortImages),
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Whether any shown product in this list is marked for women / men (then the filter is offered). */
export async function hasAudienceProducts(department?: Department, categorySlug?: string | null): Promise<boolean> {
  let query = getSupabasePublic()
    .from("products")
    .select("id, category:categories!inner(department, slug)", { count: "exact", head: true })
    .eq("status", "active")
    .not("audience", "is", null);
  if (department) query = query.eq("category.department", department);
  if (categorySlug) query = query.eq("category.slug", categorySlug);
  const { count, error } = await query;
  if (error) throw new Error(`audience: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function getFeaturedProducts(limit = 8): Promise<ProductCardData[]> {
  const { data, error } = await getSupabasePublic()
    .from("products")
    .select(PRODUCT_CARD)
    .eq("status", "active")
    .eq("is_featured", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`featured: ${error.message}`);
  return (data as unknown as ProductCardData[]).map(sortImages);
}

export async function getOnSaleProducts(limit = 8): Promise<ProductCardData[]> {
  const { data, error } = await getSupabasePublic()
    .from("products")
    .select(PRODUCT_CARD)
    .eq("status", "active")
    .not("sale_price_etb", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`on sale: ${error.message}`);
  return (data as unknown as ProductCardData[]).map(sortImages);
}

export const getProductBySlug = cache(async (slug: string): Promise<ProductDetail | null> => {
  const { data, error } = await getSupabasePublic()
    .from("products")
    .select(`${PRODUCT_CARD}, description_en, description_am`)
    .eq("status", "active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`product: ${error.message}`);
  return data ? sortImages(data as unknown as ProductDetail) : null;
});

export async function getRelatedProducts(product: ProductCardData, limit = 4): Promise<ProductCardData[]> {
  const { data, error } = await getSupabasePublic()
    .from("products")
    .select(PRODUCT_CARD)
    .eq("status", "active")
    .eq("category_id", product.category.id)
    .neq("id", product.id)
    .limit(limit);
  if (error) throw new Error(`related: ${error.message}`);
  return (data as unknown as ProductCardData[]).map(sortImages);
}

/** Current public data for the products in a cart (prices are always re-read). */
export async function getProductsByIds(ids: string[]): Promise<ProductCardData[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabasePublic()
    .from("products")
    .select(PRODUCT_CARD)
    .eq("status", "active")
    .in("id", ids);
  if (error) throw new Error(`cart products: ${error.message}`);
  return (data as unknown as ProductCardData[]).map(sortImages);
}

export interface Banner {
  id: string;
  title_en: string;
  title_am: string;
  subtitle_en: string;
  subtitle_am: string;
  image_path: string;
  link_href: string | null;
}

export async function getHomepageBanners(): Promise<Banner[]> {
  const { data, error } = await getSupabasePublic()
    .from("homepage_banners")
    .select("id, title_en, title_am, subtitle_en, subtitle_am, image_path, link_href")
    .order("sort_order");
  if (error) throw new Error(`banners: ${error.message}`);
  return data;
}

export interface Promotion {
  id: string;
  title_en: string;
  title_am: string;
  description_en: string;
  description_am: string;
  discount_type: string;
  discount_value: number;
  code: string | null;
  ends_at: string | null;
}

export async function getHomepagePromotions(): Promise<Promotion[]> {
  const { data, error } = await getSupabasePublic()
    .from("promotions")
    .select("id, title_en, title_am, description_en, description_am, discount_type, discount_value, code, ends_at")
    .eq("show_on_homepage", true)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) throw new Error(`promotions: ${error.message}`);
  return data;
}

export interface DeliveryZone {
  id: string;
  name_en: string;
  name_am: string;
  fee_etb: number;
  estimated_days: string | null;
}

export interface PartnerShop {
  id: string;
  name: string;
  zone_id: string;
  city: string;
  city_am: string;
  fee_etb: number;
  address_line: string;
  landmark: string | null;
  phone: string;
  opening_hours: string | null;
  map_url: string | null;
}

/** Partner shops customers can collect from (active shop in an active city). */
export const getPartnerShops = cache(async (): Promise<PartnerShop[]> => {
  const { data, error } = await getSupabasePublic().rpc("public_partner_shops");
  if (error) throw new Error(`partner shops: ${error.message}`);
  return (data ?? []).map((s) => ({ ...s, fee_etb: Number(s.fee_etb) }));
});

export const getDeliveryZones = cache(async (): Promise<DeliveryZone[]> => {
  const { data, error } = await getSupabasePublic()
    .from("delivery_zones")
    .select("id, name_en, name_am, fee_etb, estimated_days")
    .order("sort_order");
  if (error) throw new Error(`delivery zones: ${error.message}`);
  return data;
});

export interface PrintPriceRow {
  color_mode: "bw" | "color";
  paper_size: string;
  sides: "single" | "double";
  price_per_page_etb: number;
}

export async function getPrintingPrices(): Promise<PrintPriceRow[]> {
  const { data, error } = await getSupabasePublic()
    .from("printing_price_rules")
    .select("color_mode, paper_size, sides, price_per_page_etb")
    .order("sort_order");
  if (error) throw new Error(`printing prices: ${error.message}`);
  return data;
}
