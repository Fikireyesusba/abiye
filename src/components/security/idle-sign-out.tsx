"use client";
import { useEffect } from "react";
import { toast } from "sonner";
import { idleSignOut } from "@/lib/security/idle-actions";
import { ACTIVE_COOKIE } from "@/lib/security/idle";

const readActive = () => {
  const m = document.cookie.match(new RegExp(`(?:^|; )${ACTIVE_COOKIE}=(\\d+)`));
  return m ? Number(m[1]) : null;
};
const writeActive = (t: number) => {
  document.cookie = `${ACTIVE_COOKIE}=${t}; path=/; max-age=2592000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
};

/**
 * Signs the user out after `minutes` without activity (clicks, taps, typing, scrolling), across all tabs
 * (the last-activity time lives in a cookie). Warns one minute before. Runs only while signed in
 * (the server sets the activity cookie for signed-in sessions).
 */
export function IdleSignOut({ minutes, kind, warning }: { minutes: number; kind: "admin" | "customer"; warning: { text: string; stay: string } }) {
  useEffect(() => {
    if (readActive() === null) return; // not signed in
    const limit = minutes * 60_000;
    let lastWrite = 0;
    let warned = false;
    let leaving = false;
    const signOutNow = async () => {
      if (leaving) return;
      leaving = true;
      await idleSignOut().catch(() => {});
      const login = kind === "admin" ? "/admin/login" : "/account/login";
      const next = kind === "customer" ? `&next=${encodeURIComponent(location.pathname)}` : "";
      // A full page load on purpose: nothing from the signed-out session stays in memory.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.href = `${login}?reason=idle${next}`;
    };
    // Too long since the last real activity? (e.g. the app or tab was reopened after hours)
    const expired = () => {
      const last = readActive();
      return last !== null && Date.now() - last >= limit;
    };
    const touch = () => {
      // Coming back after the limit is NOT activity: sign out instead of starting a new period.
      if (expired()) { void signOutNow(); return; }
      const now = Date.now();
      if (now - lastWrite > 15_000) { writeActive(now); lastWrite = now; }
      if (warned) { warned = false; toast.dismiss("idle-warning"); }
    };
    if (expired()) { void signOutNow(); return; }
    touch();
    // Only real input counts (a programmatic "scroll" event must not keep a session alive).
    const events = ["pointerdown", "keydown", "touchstart", "mousemove", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    // Phones pause timers in the background: check as soon as the app is shown again.
    const onShow = () => { if (document.visibilityState === "visible" && expired()) void signOutNow(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    const tick = window.setInterval(() => {
      const last = readActive();
      if (last === null || leaving) return;
      const idle = Date.now() - last;
      if (idle >= limit) {
        void signOutNow();
      } else if (idle >= limit - 60_000 && !warned) {
        warned = true;
        toast.warning(warning.text, { id: "idle-warning", duration: 60_000, action: { label: warning.stay, onClick: () => { lastWrite = 0; touch(); } } });
      }
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.clearInterval(tick);
    };
  }, [minutes, kind, warning.text, warning.stay]);
  return null;
}
