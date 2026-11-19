import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/account/auth-card";
import { SignUpForm } from "@/components/account/auth-forms";
import { getCustomerUser, safeNext } from "@/lib/account/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("signUp"), robots: { index: false } };
}

export default async function SignUpPage({ searchParams }: PageProps<"/account/signup">) {
  const next = safeNext((await searchParams).next);
  if (await getCustomerUser()) redirect(next);
  const t = await getTranslations("account");
  return (
    <AuthCard title={t("signUpTitle")} intro={t("signUpIntro")}>
      <SignUpForm next={next} />
    </AuthCard>
  );
}
