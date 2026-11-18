import { formatETB, toSantim } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Effective price with optional struck-through regular price. Server or client safe. */
export function Price({
  price,
  salePrice,
  locale,
  size = "md",
  className,
}: {
  price: number;
  salePrice: number | null;
  locale: "en" | "am";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const onSale = salePrice !== null && salePrice < price;
  const current = toSantim(onSale ? salePrice : price);
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span
        className={cn(
          "font-semibold tabular-nums",
          size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base",
          onSale && "text-destructive",
        )}
      >
        {formatETB(current, locale)}
      </span>
      {onSale && (
        <s className={cn("text-muted-foreground tabular-nums", size === "lg" ? "text-base" : "text-xs")}>
          {formatETB(toSantim(price), locale)}
        </s>
      )}
    </span>
  );
}

export function discountPercent(price: number, salePrice: number | null): number | null {
  if (salePrice === null || salePrice >= price) return null;
  return Math.round((1 - salePrice / price) * 100);
}
