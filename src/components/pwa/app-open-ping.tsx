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
        localStorage.setItem(LAST_KEY, stamp);
        void recordAppOpen(id, platform()).catch(() => null);
      } catch { /* storage blocked: not counted */ }
    };
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) send();
    window.addEventListener("appinstalled", send);
    return () => window.removeEventListener("appinstalled", send);
  }, [account]);
  return null;
}
