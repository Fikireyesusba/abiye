"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isPushSubscribed, removePushSubscription, savePushSubscription } from "@/lib/push/actions";
import { cn } from "@/lib/utils";
import { InstallAppButton, useInstallState } from "./pwa";

type State = "loading" | "unsupported" | "install-first" | "denied" | "off" | "on";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Turn phone notifications on/off for THIS device (signed-in customers).
 * iPhone: only possible inside the installed app (iOS 16.4+), so we guide to install first.
 */
export function PushToggle({ vapidPublicKey, className, hint }: { vapidPublicKey: string | null; className?: string; hint?: string }) {
  const t = useTranslations("push");
  const locale = useLocale();
  const install = useInstallState();
  const [state, setState] = useState<State>("loading");
  const [pending, start] = useTransition();

  const refresh = useCallback(async (isCurrent: () => boolean = () => true) => {
    const set = (v: State) => { if (isCurrent()) setState(v); };
    // iPhone/iPad: web notifications only work inside the installed app (iOS 16.4+).
    if (install.platform === "ios" && !install.standalone) return set("install-first");
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return set("unsupported");
    if (Notification.permission === "denied") return set("denied");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    set(sub && (await isPushSubscribed(sub.endpoint).catch(() => false)) ? "on" : "off");
  }, [install.platform, install.standalone]);

  useEffect(() => {
    if (!vapidPublicKey) return;
    // A newer check (e.g. once the device type is known) replaces an older one still running.
    let current = true;
    void refresh(() => current);
    return () => { current = false; };
  }, [refresh, vapidPublicKey]);

  if (!vapidPublicKey || state === "loading") return null;

  const turnOn = () =>
    start(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return void (await refresh());
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }));
        const res = await savePushSubscription(sub.toJSON(), locale);
        if (!res.ok) throw new Error(res.error);
        toast.success(t("turnedOn"));
        setState("on");
      } catch {
        toast.error(t("failed"));
        await refresh();
      }
    });
  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint).catch(() => null);
        await sub.unsubscribe().catch(() => false);
      }
      toast.success(t("turnedOff"));
      setState("off");
    });

  return (
    <div className={cn("space-y-2 text-sm", className)}>
      {state === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 font-medium text-success"><BellRing className="size-4" aria-hidden /> {t("on")}</span>
          <Button type="button" variant="ghost" size="sm" onClick={turnOff} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <BellOff />} {t("turnOff")}</Button>
        </div>
      )}
      {state === "off" && (
        <>
          {hint && <p className="text-muted-foreground">{hint}</p>}
          <Button type="button" onClick={turnOn} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Bell />} {t("turnOn")}</Button>
        </>
      )}
      {state === "install-first" && (
        <>
          <p className="text-muted-foreground">{t("iosInstallFirst")}</p>
          <InstallAppButton variant="default" />
        </>
      )}
      {state === "denied" && <p className="text-muted-foreground">{t("blocked")}</p>}
      {state === "unsupported" && <p className="text-muted-foreground">{t("unsupported")}</p>}
    </div>
  );
}
