import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Read-only star rating (rounded to half stars visually via fill of whole stars). */
export function Stars({ value, className, size = "sm", label }: { value: number; className?: string; size?: "sm" | "md"; label: string }) {
  const full = Math.round(value);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden className={cn(size === "sm" ? "size-3.5" : "size-5", i <= full ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/40")} />
      ))}
    </span>
  );
}
