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
  document.cookie = `${ACTIVE_COOKIE}=${t}; path=/; max-age=86400; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
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
    const touch = () => {
      const now = Date.now();
      if (now - lastWrite > 15_000) { writeActive(now); lastWrite = now; }
      if (warned) { warned = false; toast.dismiss("idle-warning"); }
    };
    touch();
    // Only real input counts (a programmatic "scroll" event must not keep a session alive).
    const events = ["pointerdown", "keydown", "touchstart", "mousemove", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const tick = window.setInterval(async () => {
      const last = readActive();
      if (last === null || leaving) return;
      const idle = Date.now() - last;
      if (idle >= limit) {
        leaving = true;
        await idleSignOut(kind).catch(() => {});
        const login = kind === "admin" ? "/admin/login" : "/account/login";
        const next = kind === "customer" ? `&next=${encodeURIComponent(location.pathname)}` : "";
        location.href = `${login}?reason=idle${next}`;
      } else if (idle >= limit - 60_000 && !warned) {
        warned = true;
        toast.warning(warning.text, { id: "idle-warning", duration: 60_000, action: { label: warning.stay, onClick: () => { lastWrite = 0; touch(); } } });
      }
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(tick);
    };
  }, [minutes, kind, warning.text, warning.stay]);
  return null;
}
