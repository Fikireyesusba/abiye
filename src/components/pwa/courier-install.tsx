"use client";
import { Smartphone } from "lucide-react";
import { InstallAppButton, useInstallState } from "./pwa";

/** Courier app: offer to install it on the phone (hidden once it runs as the installed app). */
export function CourierInstallCard() {
  const s = useInstallState();
  if (s.standalone) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4" data-testid="courier-install">
      <Smartphone className="size-6 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Install the courier app</p>
        <p className="text-sm text-muted-foreground">Open your deliveries from the home screen, full screen, like any app.</p>
      </div>
      <InstallAppButton variant="default" className="w-full sm:w-auto" />
    </div>
  );
}
