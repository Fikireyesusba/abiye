import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { PushToggle } from "@/components/pwa/push";
import { Card, CardContent } from "@/components/ui/card";
import { requireCustomer } from "@/lib/account/session";
import { getServerEnv } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("push.title"), robots: { index: false } };
}

export default async function PhoneNotificationsPage() {
  await requireCustomer("/account/notifications");
  const env = getServerEnv();
  const vapid = env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? (env.VAPID_PUBLIC_KEY ?? null) : null;
  if (!vapid) notFound();
  const t = await getTranslations();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/account" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t("account.title")}</Link>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">{t("push.title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("push.text")}</p>
      <Card><CardContent className="pt-6"><PushToggle vapidPublicKey={vapid} /></CardContent></Card>
    </div>
  );
}
