"use client";
import { useEffect } from "react";
import { useLocale } from "next-intl";
import { savePushSubscription } from "@/lib/push/actions";
import { PUSH_CLAIM_COOKIE } from "@/lib/security/session-cookies";

/**
 * Right after a customer signs in: if this device already has phone
 * notifications switched on (possibly for another account), they now go to
 * the account that just signed in — never to two accounts on one device.
 */
export function PushClaim() {
  const locale = useLocale();
  useEffect(() => {
    if (!document.cookie.split("; ").some((c) => c === `${PUSH_CLAIM_COOKIE}=1`)) return;
    document.cookie = `${PUSH_CLAIM_COOKIE}=; path=/; max-age=0`;
    if (!("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
    void (async () => {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) await savePushSubscription(sub.toJSON(), locale).catch(() => null);
    })();
  }, [locale]);
  return null;
}
