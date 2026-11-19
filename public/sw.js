/*
 * Abiye service worker — kept deliberately small and safe:
 *  - pages always come from the network (prices, stock and orders are never stale);
 *    only when the phone is offline do we show the cached offline page;
 *  - build assets (/_next/static, immutable) and app icons are cached for speed;
 *  - nothing private (orders, account, admin, receipts) is ever stored.
 */
const VERSION = "v1";
const STATIC = `abiye-static-${VERSION}`;
const PAGES = `abiye-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGES).then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("abiye-") && k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Old build files pile up after each website update: keep only the newest MAX_STATIC entries. */
const MAX_STATIC = 150;
async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_STATIC))) await cache.delete(k);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          await cache.put(req, res.clone());
          trim(cache);
        }
        return res;
      }),
    );
  }
});
