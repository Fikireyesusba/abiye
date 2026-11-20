"use server";
import { z } from "zod";
import { getDeliveryZones, getProductsByIds, type DeliveryZone } from "@/lib/catalog/queries";
import { getSiteSettings } from "@/lib/catalog/settings";
import { getCustomerUser } from "@/lib/account/session";
import { getJobsForCart } from "@/lib/printing/access";
import { publicImageUrl } from "@/lib/storage";

export interface CartProductView {
  id: string;
  slug: string;
  name_en: string;
  name_am: string;
  price_etb: number;
  sale_price_etb: number | null;
  unit_price_etb: number;
  available: number | null; // null = not stock-tracked
  imageUrl: string | null;
  department: string;
}

export interface CartPrintingView {
  id: string;
  job_number: string;
  payable: boolean; // priced, awaiting payment and not already in an order
  total_etb: number | null;
  summary: { color_mode: string; paper_size: string; sides: string; copies: number; page_count: number | null };
}

export interface CartDetails {
  products: CartProductView[];
  printing: CartPrintingView[];
  zones: DeliveryZone[];
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  freeDeliveryThresholdEtb: number | null;
}

const inputSchema = z.object({
  productIds: z.array(z.guid()).max(50),
  printing: z.array(z.object({ id: z.guid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() })).max(10).default([]),
});

/** Fresh catalog data for the cart page. Read-only; anything missing is no longer for sale. */
export async function getCartDetails(input: unknown): Promise<CartDetails> {
  const { productIds: ids, printing } = inputSchema.parse(input);
  const [products, zones, settings, jobs] = await Promise.all([
    getProductsByIds([...new Set(ids)]),
    getDeliveryZones(),
    getSiteSettings(),
    getCustomerUser().then((u) => getJobsForCart(printing, u?.id)),
  ]);
  return {
    printing: jobs.map((j) => ({
      id: j.id,
      job_number: j.job_number,
      payable: j.status === "awaiting_payment" && j.order_id === null && j.total_etb !== null,
      total_etb: j.total_etb,
      summary: { color_mode: j.color_mode, paper_size: j.paper_size, sides: j.sides, copies: j.copies, page_count: j.page_count },
    })),
    products: products.map((p) => ({
      id: p.id,
      slug: p.slug,
      name_en: p.name_en,
      name_am: p.name_am,
      price_etb: p.price_etb,
      sale_price_etb: p.sale_price_etb,
      unit_price_etb: p.effective_price_etb,
      available: p.track_inventory ? p.stock_quantity : null,
      imageUrl: publicImageUrl("product-images", p.images[0]?.storage_path),
      department: p.category.department,
    })),
    zones,
    pickupEnabled: settings.delivery.pickup_enabled,
    // Home delivery only when it is switched on AND at least one delivery city is active.
    deliveryEnabled: settings.delivery.delivery_enabled && zones.length > 0,
    freeDeliveryThresholdEtb: settings.delivery.free_delivery_threshold_etb,
  };
}
