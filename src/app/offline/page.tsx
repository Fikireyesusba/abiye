import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/** Shown by the app (service worker) when the phone has no internet. Plain HTML: works without scripts. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><WifiOff className="size-7" aria-hidden /></span>
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="max-w-sm text-muted-foreground">Check your internet connection and try again.</p>
      <h2 lang="am" className="text-xl font-semibold">ከበይነመረብ ጋር አልተገናኙም</h2>
      <p lang="am" className="max-w-sm text-muted-foreground">የበይነመረብ ግንኙነትዎን ያረጋግጡ እና እንደገና ይሞክሩ።</p>
      {/* Plain link on purpose: a full page load, which works even when app scripts are unavailable offline. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground">Try again · እንደገና ይሞክሩ</a>
    </main>
  );
}
