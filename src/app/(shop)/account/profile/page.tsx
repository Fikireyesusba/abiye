import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Bell, ChevronRight, FileText, LogOut, MapPin, Palette, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { ThemePicker } from "@/components/theme/theme";
import { signOutCustomer } from "@/lib/account/actions";
import { getCustomerAccount, requireCustomer } from "@/lib/account/session";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme";
import pkg from "../../../../../package.json";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title"), robots: { index: false } };
}

function Row({ href, icon: Icon, label, hint }: { href: string; icon: typeof Bell; label: string; hint?: string }) {
  return (
  <li>
    <Link href={href} className="flex items-center gap-4 px-4 py-4 hover:bg-muted/40">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block truncate text-sm text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  </li>
  );
}

/** Profile: who you are, settings (theme, saved address) and the legal pages. Notifications are in the side menu. */
export default async function ProfilePage() {
  const user = await requireCustomer("/account/profile");
  const [t, account, jar] = await Promise.all([getTranslations("profile"), getCustomerAccount(user.id), cookies()]);
  const name = account?.full_name || user.email;
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
      <div className="mb-6 flex items-center">
        <Link href="/account" aria-label="Back" className="-ml-2 rounded-full p-2 hover:bg-secondary"><ArrowLeft className="size-5" aria-hidden /></Link>
        <h1 className="flex-1 pr-9 text-center text-2xl font-semibold">{t("title")}</h1>
      </div>
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <span className="flex size-24 items-center justify-center rounded-full bg-primary/10 text-3xl font-semibold text-primary" aria-hidden>
          {initials || <UserRound className="size-10" />}
        </span>
        <p className="text-lg font-semibold">{name}</p>
        <p className="text-sm text-muted-foreground">{user.email}</p>
        {account?.member_id && <p className="font-mono text-sm text-muted-foreground" data-testid="profile-user-id">{t("userId", { id: account.member_id })}</p>}
      </div>

      <section className="mb-4 overflow-hidden rounded-2xl border bg-card">
        <ul className="divide-y">
          <Row href="/account/details" icon={UserRound} label={t("personalDetails")} hint={account?.phone ?? undefined} />
          <li className="px-4 py-4">
            <div className="mb-3 flex items-center gap-4"><Palette className="size-5 text-muted-foreground" aria-hidden /><span>{t("theme")}</span></div>
            <ThemePicker initial={themeFromCookie(jar.get(THEME_COOKIE)?.value)} />
          </li>
          <Row href="/account/details" icon={MapPin} label={t("savedAddress")} hint={account?.default_address ?? undefined} />
        </ul>
      </section>

      <section className="mb-6 overflow-hidden rounded-2xl border bg-card">
        <ul className="divide-y">
          <li className="flex items-center gap-4 px-4 py-4">
            <Smartphone className="size-5 text-muted-foreground" aria-hidden />
            <span className="flex-1">{t("appVersion")}</span>
            <span className="text-sm text-muted-foreground">v{pkg.version}</span>
          </li>
          <Row href="/privacy" icon={ShieldCheck} label={t("privacy")} />
          <Row href="/terms" icon={FileText} label={t("terms")} />
        </ul>
      </section>

      <form action={signOutCustomer}>
        <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-2xl border bg-card px-4 py-3 text-destructive hover:bg-destructive/5">
          <LogOut className="size-5" aria-hidden /> {t("signOut")}
        </button>
      </form>
    </div>
  );
}
