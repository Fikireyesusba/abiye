"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("pages");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t("errorTitle")}</h1>
      <p className="text-muted-foreground">{t("errorText")}</p>
      <div className="flex gap-3">
        <Button onClick={reset}>{t("tryAgain")}</Button>
        <Button variant="outline" asChild>
          <Link href="/">{t("goHome")}</Link>
        </Button>
      </div>
    </div>
  );
}
