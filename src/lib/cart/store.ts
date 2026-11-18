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
export type CartItem = CartProductItem;

export interface FulfillmentPrefs {
  method: "delivery" | "pickup";
  deliveryZoneId: string | null;
}

const CART_KEY = "cart:v1";
const PREFS_KEY = "checkout:prefs:v1";
const EVENT = "cart:change";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: CartItem[] = [];

let cachedRaw: string | null = null;
let cachedItems: CartItem[] = EMPTY;

function sanitize(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return EMPTY;
  const seen = new Map<string, CartItem>();
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const { type, productId, quantity } = v as Record<string, unknown>;
    if (type !== "product" || typeof productId !== "string" || !GUID.test(productId)) continue;
    if (!Number.isInteger(quantity) || (quantity as number) < 1) continue;
    const prev = seen.get(productId)?.quantity ?? 0;
    seen.set(productId, { type, productId, quantity: Math.min(MAX_LINE_QUANTITY, prev + (quantity as number)) });
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
  return useCart().reduce((n, i) => n + i.quantity, 0);
}

export const cart = {
  add(productId: string, quantity = 1) {
    write(sanitize([...read(), { type: "product", productId, quantity }]));
  },
  setQuantity(productId: string, quantity: number) {
    const q = Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.trunc(quantity)));
    write(read().map((i) => (i.productId === productId ? { ...i, quantity: q } : i)));
  },
  remove(productId: string) {
    write(read().filter((i) => i.productId !== productId));
  },
  clear() {
    write([]);
  },
};

export function readFulfillmentPrefs(): FulfillmentPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null");
    if (v && (v.method === "delivery" || v.method === "pickup")) {
      return { method: v.method, deliveryZoneId: typeof v.deliveryZoneId === "string" ? v.deliveryZoneId : null };
    }
  } catch {}
  return { method: "delivery", deliveryZoneId: null };
}

export function saveFulfillmentPrefs(p: FulfillmentPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}
