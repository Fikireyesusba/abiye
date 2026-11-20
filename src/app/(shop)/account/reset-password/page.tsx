import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/account/auth-card";
import { ResetPasswordForm } from "@/components/account/auth-forms";
import { getSignedInUserId } from "@/lib/account/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("resetTitle"), robots: { index: false } };
}

/** Reached from the emailed reset link: /auth/confirm has already signed the user in for this. */
export default async function ResetPasswordPage() {
  if (!(await getSignedInUserId())) redirect("/account/login?error=link");
  const t = await getTranslations("account");
  return <AuthCard title={t("resetTitle")}><ResetPasswordForm /></AuthCard>;
}
