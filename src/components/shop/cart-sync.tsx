"use client";
import { useEffect } from "react";
import { useCart } from "@/lib/cart/store";
import { syncSavedCart } from "@/lib/cart/sync-action";

const KEY = "cart:synced:v1";

/** Supabase session cookies are readable by JS (not secrets on their own); skip work for guests. */
const looksSignedIn = () => /(?:^|;\s*)sb-[^=]*-auth-token/.test(document.cookie);

/** Keeps a signed-in customer's basket saved on their account (debounced). Renders nothing. */
export function CartSync() {
  const items = useCart();
  useEffect(() => {
    if (!looksSignedIn()) return;
    const lines = items.flatMap((i) => (i.type === "product" ? [{ productId: i.productId, quantity: i.quantity }] : []));
    const snapshot = JSON.stringify(lines);
    let last: string | null = null;
    try { last = window.sessionStorage.getItem(KEY); } catch {}
    if (last === snapshot) return;
    const timer = window.setTimeout(() => {
      syncSavedCart(lines)
        .then((r) => {
          if (r.saved) try { window.sessionStorage.setItem(KEY, snapshot); } catch {}
        })
        .catch(() => {});
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [items]);
  return null;
}
