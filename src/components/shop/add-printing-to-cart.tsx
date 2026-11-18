"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cart, useCart } from "@/lib/cart/store";

export function AddPrintingToCart({ jobId, accessToken }: { jobId: string; accessToken: string }) {
  const t = useTranslations("printJob");
  const inCart = useCart().some((i) => i.type === "printing" && i.printingJobId === jobId);
  if (inCart) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success"><Check className="size-4" /> {t("inCart")}</span>
        <Button asChild><Link href="/cart">{t("goToCart")}</Link></Button>
      </div>
    );
  }
  return (
    <Button size="lg" onClick={() => cart.addPrinting(jobId, accessToken)}>
      <ShoppingBag /> {t("addToCart")}
    </Button>
  );
}
