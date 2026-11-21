import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { ProfileForm } from "@/components/account/auth-forms";
import { Card, CardContent } from "@/components/ui/card";
import { getCustomerAccount, requireCustomer } from "@/lib/account/session";
import { getDeliveryZones } from "@/lib/catalog/queries";
import { formatEthiopianPhone } from "@/lib/validation/phone";
import { localized, type Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("account.personalDetails"), robots: { index: false } };
}

export default async function PersonalDetailsPage() {
  const user = await requireCustomer("/account/details");
  const [t, locale, account, zones] = await Promise.all([getTranslations(), getLocale() as Promise<Locale>, getCustomerAccount(user.id), getDeliveryZones()]);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/account" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t("account.title")}</Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("account.personalDetails")}</h1>
      <Card>
        <CardContent className="pt-6">
            <ProfileForm
            zones={zones.map((z) => ({ id: z.id, name: localized(z, "name", locale) }))}
            details={{
              fullName: account?.full_name ?? "", email: user.email,
              phone: account?.phone ? formatEthiopianPhone(account.phone) : "",
              dateOfBirth: account?.date_of_birth ?? "", sex: account?.sex ?? "",
              zoneId: account?.default_zone_id ?? null, address: account?.default_address ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
