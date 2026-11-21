import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/account/auth-card";
import { SignInForm } from "@/components/account/auth-forms";
import { getCustomerUser, safeNext } from "@/lib/account/session";
import { IDLE_MINUTES } from "@/lib/security/idle";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("signIn"), robots: { index: false } };
}

export default async function LoginPage({ searchParams }: PageProps<"/account/login">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getCustomerUser()) redirect(next);
  const t = await getTranslations("account");
  return (
    <AuthCard title={t("signInTitle")} intro={next === "/checkout" ? t("signInToOrder") : next.startsWith("/printing") ? t("signInToPrint") : undefined}>
      {sp.error === "link" && <p className="mb-4 rounded-md bg-destructive/5 p-3 text-sm text-destructive">{t("linkError")}</p>}
      {sp.reason === "elsewhere" && <p className="mb-4 rounded-md bg-muted p-3 text-sm" role="status">{t("signedInElsewhere")}</p>}
      {sp.reason === "idle" && <p className="mb-4 rounded-md bg-muted p-3 text-sm" role="status">{t("idleSignedOut", { minutes: IDLE_MINUTES.customer })}</p>}
      <SignInForm next={next} />
    </AuthCard>
  );
}
