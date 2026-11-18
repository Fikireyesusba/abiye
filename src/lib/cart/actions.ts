"use server";
import { z } from "zod";
import { getDeliveryZones, getProductsByIds, type DeliveryZone } from "@/lib/catalog/queries";
import { getSiteSettings } from "@/lib/catalog/settings";
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

export interface CartDetails {
  products: CartProductView[];
  zones: DeliveryZone[];
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  freeDeliveryThresholdEtb: number | null;
}

const idsSchema = z.array(z.guid()).max(50);

/** Fresh catalog data for the cart page. Read-only; anything missing is no longer for sale. */
export async function getCartDetails(productIds: unknown): Promise<CartDetails> {
  const ids = idsSchema.parse(productIds);
  const [products, zones, settings] = await Promise.all([getProductsByIds([...new Set(ids)]), getDeliveryZones(), getSiteSettings()]);
  return {
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
    deliveryEnabled: settings.delivery.delivery_enabled,
    freeDeliveryThresholdEtb: settings.delivery.free_delivery_threshold_etb,
  };
}
