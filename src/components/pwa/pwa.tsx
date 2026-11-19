"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Download, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ install state (shared) */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type Platform = "android" | "ios" | "other";
interface InstallState {
  standalone: boolean;
  canPrompt: boolean;
  platform: Platform;
}
const SERVER: InstallState = { standalone: false, canPrompt: false, platform: "other" };
let snapshot = SERVER;
function read(): InstallState {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const next: InstallState = {
    standalone: installed || window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true,
    canPrompt: !!deferred,
    platform: ios ? "ios" : /Android/.test(ua) ? "android" : "other",
  };
  if (next.standalone !== snapshot.standalone || next.canPrompt !== snapshot.canPrompt || next.platform !== snapshot.platform) snapshot = next;
  return snapshot;
}
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}

async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => null);
  deferred = null;
  emit();
}

/* ------------------------------------------------------------------ service worker */
/** Registers /sw.js (production only). Renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

/* ------------------------------------------------------------------ iPhone instructions */
function IosSteps({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("pwa");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl" closeLabel={t("close")}>
        <SheetHeader>
          <SheetTitle>{t("iosTitle")}</SheetTitle>
          <SheetDescription>{t("iosIntro")}</SheetDescription>
        </SheetHeader>
        <ol className="space-y-4 px-4 pb-8">
          {[
            { icon: Share, text: t("iosStep1") },
            { icon: PlusSquare, text: t("iosStep2") },
            { icon: Smartphone, text: t("iosStep3") },
          ].map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>{i + 1}</span>
              <Icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ button (footer, help page) */
export function InstallAppButton({ className, variant = "outline" }: { className?: string; variant?: "outline" | "default" }) {
  const t = useTranslations("pwa");
  const s = useInstallState();
  const [ios, setIos] = useState(false);
  if (s.standalone) return <p className={cn("text-sm text-muted-foreground", className)}>{t("alreadyInstalled")}</p>;
  if (!s.canPrompt && s.platform !== "ios") {
    // e.g. desktop/other browsers without an install prompt: explain instead of a dead button
    return <p className={cn("text-sm text-muted-foreground", className)}>{s.platform === "android" ? t("androidMenuHint") : t("otherHint")}</p>;
  }
  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => (s.canPrompt ? void promptInstall() : setIos(true))}>
        <Download /> {t("install")}
      </Button>
      <IosSteps open={ios} onOpenChange={setIos} />
    </>
  );
}

/* ------------------------------------------------------------------ banner (phones, dismissible) */
const DISMISS_KEY = "pwa:banner-dismissed";
const DISMISS_DAYS = 14;

export function InstallBanner() {
  const t = useTranslations("pwa");
  const s = useInstallState();
  const [dismissed, setDismissed] = useState(true);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    let at = 0;
    try { at = Number(localStorage.getItem(DISMISS_KEY) ?? 0); } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage after hydration
    setDismissed(Date.now() - at < DISMISS_DAYS * 86400000);
  }, []);
  const show = !dismissed && !s.standalone && (s.canPrompt || s.platform === "ios");
  if (!show) return <IosSteps open={ios} onOpenChange={setIos} />;
  const close = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };
  return (
    <>
      <div role="region" aria-label={t("bannerLabel")} className="fixed inset-x-3 bottom-3 z-50 flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-lg sm:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static icon */}
        <img src="/app-icon/192" alt="" width={44} height={44} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("bannerTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("bannerText")}</p>
        </div>
        <Button type="button" size="sm" onClick={() => (s.canPrompt ? void promptInstall() : setIos(true))}>{t("install")}</Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={close} aria-label={t("dismiss")}><X className="size-4" /></Button>
      </div>
      <IosSteps open={ios} onOpenChange={setIos} />
    </>
  );
}
