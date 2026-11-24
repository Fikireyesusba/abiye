"use client";
import { useSyncExternalStore } from "react";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "@/lib/pricing/cart";

/**
 * Browser cart. Holds ONLY ids and quantities — never prices. Display data is
 * re-fetched from the server (getCartDetails) and checkout recomputes everything
 * in the database.
 */
export interface CartProductItem {
  type: "product";
  productId: string;
  quantity: number;
}
/** A priced printing job. The token proves ownership; the price is re-read on the server. */
export interface CartPrintingItem {
  type: "printing";
  printingJobId: string;
  /** Absent when added by the signed-in owner (ownership is checked on the server). */
  accessToken?: string;
}
export type CartItem = CartProductItem | CartPrintingItem;
export const itemKey = (i: CartItem) => (i.type === "product" ? i.productId : i.printingJobId);

export interface FulfillmentPrefs {
  method: "delivery" | "pickup" | "partner";
  deliveryZoneId: string | null;
  /** Pick up at a partner shop (method "partner"). */
  partnerShopId?: string | null;
}

const CART_KEY = "cart:v1";
const PREFS_KEY = "checkout:prefs:v1";
const EVENT = "cart:change";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: CartItem[] = [];

let cachedRaw: string | null = null;
let cachedItems: CartItem[] = EMPTY;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function sanitize(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return EMPTY;
  const seen = new Map<string, CartItem>();
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (r.type === "printing") {
      if (typeof r.printingJobId === "string" && GUID.test(r.printingJobId)) {
        const token = typeof r.accessToken === "string" && TOKEN.test(r.accessToken) ? r.accessToken : undefined;
        seen.set(r.printingJobId, { type: "printing", printingJobId: r.printingJobId, ...(token ? { accessToken: token } : {}) });
      }
      continue;
    }
    const { type, productId, quantity } = r;
    if (type !== "product" || typeof productId !== "string" || !GUID.test(productId)) continue;
    if (!Number.isInteger(quantity) || (quantity as number) < 1) continue;
    const prevItem = seen.get(productId);
    const prev = prevItem?.type === "product" ? prevItem.quantity : 0;
    seen.set(productId, { type: "product", productId, quantity: Math.min(MAX_LINE_QUANTITY, prev + (quantity as number)) });
  }
  return [...seen.values()].slice(0, MAX_CART_LINES);
}

function read(): CartItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CART_KEY);
  } catch {
    return cachedItems;
  }
  if (raw === cachedRaw) return cachedItems;
  cachedRaw = raw;
  try {
    cachedItems = raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    cachedItems = EMPTY;
  }
  return cachedItems;
}

function write(items: CartItem[]) {
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked (private mode): keep working in memory for this page.
    cachedRaw = JSON.stringify(items);
    cachedItems = items;
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => e.key === CART_KEY && cb();
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage); // sync across tabs
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function useCartCount(): number {
  return useCart().reduce((n, i) => n + (i.type === "product" ? i.quantity : 1), 0);
}

export const cart = {
  add(productId: string, quantity = 1) {
    write(sanitize([...read(), { type: "product", productId, quantity }]));
  },
  addPrinting(printingJobId: string, accessToken?: string | null) {
    write(sanitize([...read(), { type: "printing", printingJobId, ...(accessToken ? { accessToken } : {}) }]));
  },
  setQuantity(productId: string, quantity: number) {
    const q = Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.trunc(quantity)));
    write(read().map((i) => (i.type === "product" && i.productId === productId ? { ...i, quantity: q } : i)));
  },
  /** Remove a product (by product id) or a printing job (by job id). */
  remove(key: string) {
    write(read().filter((i) => itemKey(i) !== key));
  },
  clear() {
    write([]);
  },
};

export function readFulfillmentPrefs(): FulfillmentPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null");
    if (v && (v.method === "delivery" || v.method === "pickup" || v.method === "partner")) {
      return { method: v.method, deliveryZoneId: typeof v.deliveryZoneId === "string" ? v.deliveryZoneId : null,
        partnerShopId: typeof v.partnerShopId === "string" && GUID.test(v.partnerShopId) ? v.partnerShopId : null };
    }
  } catch {}
  return { method: "delivery", deliveryZoneId: null };
}

export function saveFulfillmentPrefs(p: FulfillmentPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}
