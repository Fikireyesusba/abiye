"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCartDetails, type CartDetails } from "./actions";
import { useCart, type CartPrintingItem, type CartProductItem } from "./store";

/** Live server data for whatever is in the basket (shared by cart + checkout). */
export function useCartDetails() {
  const items = useCart();
  const productItems = useMemo(() => items.filter((i): i is CartProductItem => i.type === "product"), [items]);
  const printingItems = useMemo(() => items.filter((i): i is CartPrintingItem => i.type === "printing"), [items]);
  const key = [...productItems.map((i) => i.productId).sort(), ...printingItems.map((i) => `p:${i.printingJobId}`).sort()].join(",");
  const [result, setResult] = useState<{ key: string; details?: CartDetails; error?: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!key) return; // empty basket (also the pre-hydration snapshot): nothing to fetch
    let cancelled = false;
    getCartDetails({
      productIds: productItems.map((i) => i.productId),
      printing: printingItems.map((i) => ({ id: i.printingJobId, token: i.accessToken })),
    })
      .then((d) => !cancelled && setResult({ key, details: d }))
      .catch(() => !cancelled && setResult({ key, error: true }));
    return () => {
      cancelled = true;
    };
    // productItems/printingItems are derived from `key`; nonce forces a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return {
    items,
    productItems,
    printingItems,
    // Keep showing the previous details while a refresh for a changed basket is in flight.
    details: result?.details ?? null,
    error: result?.key === key && !!result.error,
    refresh,
  };
}
