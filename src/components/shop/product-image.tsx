import Image from "next/image";
import { Printer, Smartphone, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const DEPT = {
  cosmetics: { icon: Sparkles, className: "from-cosmetics/15 to-cosmetics/5 text-cosmetics" },
  electronics: { icon: Smartphone, className: "from-electronics/15 to-electronics/5 text-electronics" },
  printing: { icon: Printer, className: "from-printing/15 to-printing/5 text-printing" },
} as const;

/** Square product image, or a branded placeholder when no image is uploaded yet. */
export function ProductImage({
  src,
  alt,
  department,
  sizes,
  priority,
  className,
}: {
  src: string | null;
  alt: string;
  department: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const dept = DEPT[department as keyof typeof DEPT] ?? DEPT.cosmetics;
  return (
    <div className={cn("relative aspect-square overflow-hidden bg-muted", className)}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <div className={cn("flex size-full items-center justify-center bg-gradient-to-br", dept.className)} role="img" aria-label={alt}>
          <dept.icon className="size-1/4 opacity-70" aria-hidden />
        </div>
      )}
    </div>
  );
}
