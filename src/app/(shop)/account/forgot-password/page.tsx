import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/account/auth-card";
import { ForgotPasswordForm } from "@/components/account/auth-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("forgotTitle"), robots: { index: false } };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("account");
  return <AuthCard title={t("forgotTitle")}><ForgotPasswordForm /></AuthCard>;
}
