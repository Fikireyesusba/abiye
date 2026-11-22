"use client";
import { useEffect } from "react";
import { recordAppOpen } from "@/lib/pwa/install-actions";

const DEVICE_KEY = "app:device:v1";
const LAST_KEY = "app:open-ping:v1";

function platform(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS/i.test(ua)) return "mac";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

/**
 * Counts installed-app use: when the page runs as the installed app (or right after it is installed),
 * tell the server once a day per device + account. Nothing is sent from a normal browser tab.
 */
export function AppOpenPing({ account }: { account: string }) {
  useEffect(() => {
    const send = () => {
      try {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
        const stamp = `${new Date().toISOString().slice(0, 10)}|${account}`;
        if (localStorage.getItem(LAST_KEY) === stamp) return;
        // Remembered only once the server has recorded it (e.g. not while the database is being updated).
        void recordAppOpen(id, platform()).then((ok) => { if (ok) localStorage.setItem(LAST_KEY, stamp); }).catch(() => null);
      } catch { /* storage blocked: not counted */ }
    };
    // Installed app: standalone window, iPhone home-screen app, or opened from the app icon (start_url ?source=app).
    const fromIcon = new URLSearchParams(window.location.search).get("source") === "app";
    if (fromIcon) try { sessionStorage.setItem("app:launched", "1"); } catch { /* ignore */ }
    let launched = false;
    try { launched = sessionStorage.getItem("app:launched") === "1"; } catch { /* ignore */ }
    const standalone = fromIcon || launched
      || ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some((m) => window.matchMedia(`(display-mode: ${m})`).matches)
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) send();
    window.addEventListener("appinstalled", send);
    return () => window.removeEventListener("appinstalled", send);
  }, [account]);
  return null;
}
