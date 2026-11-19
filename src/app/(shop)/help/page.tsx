import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight, Banknote, CircleHelp, ClipboardList, Lightbulb, Printer, RefreshCw, Search, ShieldCheck, ShoppingCart, Store, Tag, Truck, UserRound,
} from "lucide-react";
import { InstallAppButton } from "@/components/pwa/pwa";
import { StatusBadge } from "@/components/status/status-badge";
import { Button } from "@/components/ui/button";
import { HELP, type HelpSection } from "@/content/help";
import { getSiteSettings } from "@/lib/catalog/settings";
import { RECEIPT_MAX_BYTES } from "@/lib/validation/upload";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("help");
  return { title: t("title"), description: t("intro") };
}

const ICONS: Record<HelpSection["icon"], React.ComponentType<{ className?: string }>> = {
  store: Store, user: UserRound, cart: ShoppingCart, clipboard: ClipboardList, bank: Banknote, truck: Truck,
  search: Search, printer: Printer, tag: Tag, shield: ShieldCheck, help: CircleHelp, refresh: RefreshCw,
};

export default async function HelpPage() {
  const [t, tp, locale, s] = await Promise.all([getTranslations("help"), getTranslations("pwa"), getLocale() as Promise<Locale>, getSiteSettings()]);
  const vars: Record<string, string> = {
    name: s.business.name[locale] || s.business.name.en,
    hours: String(s.delivery.payment_window_hours),
    days: String(s.printing.retention_days),
    mb: String(s.printing.max_file_mb),
    receiptMb: String(RECEIPT_MAX_BYTES / 1024 / 1024),
  };
  const tr = (v: { en: string; am: string }) => (v[locale] || v.en).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </header>

      <section aria-labelledby="install-title" className="mb-6 flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static icon */}
        <img src="/icons/icon-192.png" alt="" width={56} height={56} className="rounded-2xl" />
        <div className="flex-1 space-y-1">
          <h2 id="install-title" className="font-semibold">{tp("helpTitle")}</h2>
          <p className="text-sm text-muted-foreground">{tp("helpText")}</p>
        </div>
        <InstallAppButton variant="default" />
      </section>

      <nav aria-labelledby="help-contents" className="mb-10 rounded-xl border bg-card p-4">
        <h2 id="help-contents" className="mb-3 text-sm font-semibold">{t("contents")}</h2>
        <ol className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {HELP.map((sec) => (
            <li key={sec.id}><a href={`#${sec.id}`} className="text-primary underline-offset-2 hover:underline">{tr(sec.title)}</a></li>
          ))}
        </ol>
      </nav>

      <div className="space-y-10">
        {HELP.map((sec) => {
          const Icon = ICONS[sec.icon];
          return (
            <section key={sec.id} id={sec.id} aria-labelledby={`${sec.id}-title`} className="scroll-mt-24 space-y-4">
              <h2 id={`${sec.id}-title`} className="flex items-center gap-3 text-xl font-semibold">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
                {tr(sec.title)}
              </h2>
              {sec.blocks.map((b, i) => {
                switch (b.kind) {
                  case "p":
                    return <p key={i} className="leading-relaxed text-muted-foreground">{tr(b.text)}</p>;
                  case "list":
                    return <ul key={i} className="list-disc space-y-1.5 pl-5 leading-relaxed">{b.items.map((x, j) => <li key={j}>{tr(x)}</li>)}</ul>;
                  case "steps":
                    return (
                      <ol key={i} className="space-y-3">
                        {b.items.map((x, j) => (
                          <li key={j} className="flex gap-3">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>{j + 1}</span>
                            <span className="pt-0.5 leading-relaxed"><span className="sr-only">{j + 1}. </span>{tr(x)}</span>
                          </li>
                        ))}
                      </ol>
                    );
                  case "tip":
                    return (
                      <p key={i} className="flex gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm leading-relaxed">
                        <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{tr(b.text)}</span>
                      </p>
                    );
                  case "statuses":
                    return (
                      <dl key={i} className="divide-y rounded-xl border bg-card">
                        {b.items.map((x) => (
                          <div key={x.status} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-4">
                            <dt className="sm:w-48 sm:shrink-0"><StatusBadge kind="order" status={x.status} /></dt>
                            <dd className="text-sm text-muted-foreground">{tr(x.text)}</dd>
                          </div>
                        ))}
                      </dl>
                    );
                  case "faq":
                    return (
                      <div key={i} className="divide-y rounded-xl border bg-card">
                        {b.items.map((x, j) => (
                          <details key={j} className="group p-4">
                            <summary className="cursor-pointer list-none font-medium marker:content-none">
                              <span className="flex items-center justify-between gap-3">{tr(x.q)}<span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>+</span></span>
                            </summary>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tr(x.a)}</p>
                          </details>
                        ))}
                      </div>
                    );
                }
              })}
              {sec.links && (
                <div className="flex flex-wrap gap-2">
                  {sec.links.map((l) => (
                    <Button key={l.href} variant="outline" size="sm" asChild><Link href={l.href}>{tr(l.label)} <ArrowRight className="size-4" aria-hidden /></Link></Button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <aside className="mt-12 rounded-xl bg-primary/5 p-6 text-center">
        <p className="font-semibold">{t("stillNeedHelp")}</p>
        <p className="mb-4 text-sm text-muted-foreground">{t("stillNeedHelpText")}</p>
        <Button asChild><Link href="/contact">{t("contactUs")}</Link></Button>
      </aside>
    </div>
  );
}
