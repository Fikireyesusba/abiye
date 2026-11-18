"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cart, useCart } from "@/lib/cart/store";
import { MAX_LINE_QUANTITY } from "@/lib/pricing/cart";
import { cn } from "@/lib/utils";

export function QuantityStepper({
  value,
  max,
  onChange,
  size = "default",
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  size?: "sm" | "default";
}) {
  const t = useTranslations("product");
  const btn = size === "sm" ? "size-8" : "size-10";
  return (
    <div className="inline-flex items-center rounded-md border bg-card">
      <button
        type="button"
        className={cn(btn, "inline-flex items-center justify-center rounded-l-md hover:bg-secondary disabled:opacity-40")}
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
        aria-label={t("decrease")}
      >
        <Minus className="size-4" />
      </button>
      <span className={cn("min-w-10 text-center tabular-nums", size === "sm" && "min-w-8 text-sm")} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={cn(btn, "inline-flex items-center justify-center rounded-r-md hover:bg-secondary disabled:opacity-40")}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={t("increase")}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/**
 * Add-to-basket control. `available` is null for untracked stock. The cart
 * never holds more than is in stock; the database re-checks at checkout.
 */
export function AddToCart({
  productId,
  available,
  showQuantity = false,
  compact = false,
}: {
  productId: string;
  available: number | null;
  showQuantity?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const items = useCart();
  const inCart = items.find((i) => i.productId === productId)?.quantity ?? 0;
  const max = Math.max(0, Math.min(MAX_LINE_QUANTITY, (available ?? MAX_LINE_QUANTITY) - inCart));
  const [qty, setQty] = useState(1);
  const soldOut = available !== null && available <= 0;

  if (soldOut) {
    return (
      <Button variant="secondary" disabled className={cn(!compact && "w-full")} size={compact ? "sm" : "lg"}>
        {t("common.outOfStock")}
      </Button>
    );
  }

  const add = () => {
    const n = Math.min(qty, max);
    if (n < 1) {
      toast.info(t("product.maxAvailable", { count: available ?? 0 }));
      return;
    }
    cart.add(productId, n);
    setQty(1);
    toast.success(t("product.addedToCart"), {
      action: { label: t("product.viewCart"), onClick: () => router.push("/cart") },
    });
  };

  return (
    <div className={cn("flex gap-3", compact ? "items-center" : "flex-col sm:flex-row")}>
      {showQuantity && <QuantityStepper value={Math.min(qty, Math.max(1, max))} max={Math.max(1, max)} onChange={setQty} />}
      <Button onClick={add} size={compact ? "sm" : "lg"} className={cn(!compact && "flex-1")} disabled={max < 1}>
        <ShoppingBag />
        {max < 1 ? t("product.maxAvailable", { count: available ?? 0 }) : t("common.addToCart")}
      </Button>
      {!compact && inCart > 0 && (
        <Button variant="outline" size="lg" asChild>
          <Link href="/cart">{t("product.viewCart")}</Link>
        </Button>
      )}
    </div>
  );
}
