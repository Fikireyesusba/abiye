"use client";
import { Smartphone } from "lucide-react";
import { InstallAppButton, useInstallState } from "./pwa";

/** Abiye Business app: offer to install it on the phone (hidden once it runs as the installed app). */
export function BusinessInstallCard() {
  const s = useInstallState();
  if (s.standalone) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4" data-testid="business-install">
      <Smartphone className="size-6 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Install Abiye Business</p>
        <p className="text-sm text-muted-foreground">Open your shop&apos;s orders from the home screen, full screen, like any app.</p>
      </div>
      <InstallAppButton variant="default" className="w-full sm:w-auto" />
    </div>
  );
}
