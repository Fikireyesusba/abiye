"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ProductImage } from "./product-image";

export function ProductGallery({ images, alt, department }: { images: { url: string; alt: string }[]; alt: string; department: string }) {
  const [active, setActive] = useState(0);
  const t = useTranslations("product");
  const current = images[active];
  return (
    <div className="space-y-3">
      <ProductImage
        src={current?.url ?? null}
        alt={current?.alt || alt}
        department={department}
        sizes="(min-width: 1024px) 50vw, 100vw"
        priority
        className="rounded-2xl border"
      />
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setActive(i)}
              aria-label={t("imageOf", { index: i + 1, total: images.length })}
              aria-current={i === active}
              className={cn(
                "w-16 shrink-0 overflow-hidden rounded-lg border-2 sm:w-20",
                i === active ? "border-primary" : "border-transparent opacity-75 hover:opacity-100",
              )}
            >
              <ProductImage src={img.url} alt="" department={department} sizes="80px" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
