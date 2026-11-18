import { useTranslations } from "next-intl";
import { Printer, Smartphone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Phase 1 placeholder. The real storefront homepage (hero, featured products,
 * banners — all admin-editable) is built in Phase 2.
 */
export default function Home() {
  const t = useTranslations("nav");
  const departments = [
    { key: "cosmetics", icon: Sparkles, color: "text-cosmetics bg-cosmetics/10" },
    { key: "electronics", icon: Smartphone, color: "text-electronics bg-electronics/10" },
    { key: "printing", icon: Printer, color: "text-printing bg-printing/10" },
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 px-4 py-16">
      <div className="space-y-4 text-center">
        <Badge variant="accent">Phase 1 · Foundation</Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Storefront under construction
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Database, security model and design system are in place. The full storefront arrives in Phase 2.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {departments.map(({ key, icon: Icon, color }) => (
          <Card key={key}>
            <CardHeader>
              <span className={`mb-2 inline-flex size-11 items-center justify-center rounded-lg ${color}`}>
                <Icon className="size-5" aria-hidden />
              </span>
              <CardTitle>{t(key)}</CardTitle>
              <CardDescription>{t("shop")}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>
    </main>
  );
}
