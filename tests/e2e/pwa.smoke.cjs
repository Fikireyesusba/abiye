/**
 * Installable app (PWA): manifest + icons, service worker, Chrome installability,
 * offline page, iPhone "Add to Home Screen" guide, dismissible banner.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/pwa.smoke.cjs   (production build on :3100)
 */
const { chromium, devices } = require("playwright");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);

(async () => {
  const b = await chromium.launch();
  try {
    const man = await (await fetch(`${B}/manifest.webmanifest`)).json();
    check(man.display === "standalone" && man.icons.some((i) => i.purpose === "maskable") && man.start_url.startsWith("/"), "manifest: standalone app with maskable icon");
    for (const i of man.icons) check((await fetch(B + i.src)).ok, `icon ${i.src} served`);
    const sw = await fetch(`${B}/sw.js`);
    check(sw.ok && /no-cache/.test(sw.headers.get("cache-control") ?? ""), "service worker served without caching");

    const ctx = await b.newContext({ ...devices["Pixel 7"] });
    const p = await ctx.newPage();
    await p.goto(B);
    check(await p.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL.endsWith("/sw.js")), "service worker active");
    const cdp = await ctx.newCDPSession(p);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    check(installabilityErrors.length === 0, `Chrome (Android) considers the site installable ${JSON.stringify(installabilityErrors)}`);
    await p.reload();
    await ctx.setOffline(true);
    await p.goto(`${B}/shop`).catch(() => {});
    check((await p.locator("h1").textContent().catch(() => "")) === "You are offline", "offline page when there is no internet");
    await ctx.setOffline(false);
    await p.goto(`${B}/shop`);
    check(await p.locator("h1").count() === 1 && !(await p.locator("text=You are offline").count()), "back online: live pages again (never served from cache)");

    const ip = await (await b.newContext({ ...devices["iPhone 14"] })).newPage();
    await ip.goto(B);
    const banner = ip.locator("[role=region][aria-label='Install the app']");
    await banner.waitFor({ timeout: 5000 }).catch(() => null);
    check(await banner.count() === 1, "iPhone: install banner shown");
    await banner.locator("button:has-text('Install app')").click();
    await ip.waitForSelector("text=Add to Home Screen");
    check(true, "iPhone: Add to Home Screen steps shown");
    await ip.keyboard.press("Escape");
    await banner.locator("button[aria-label='Not now']").click();
    await ip.reload();
    await ip.waitForTimeout(800);
    check(await banner.count() === 0, "banner stays hidden after “Not now”");
    check((await ip.locator("link[rel='apple-touch-icon']").getAttribute("href")) === "/icons/apple-touch-icon.png", "iPhone home-screen icon");
    await ip.goto(`${B}/help`);
    check(await ip.locator("#install-title").count() === 1, "Help page explains installing the app");

    const d = await (await b.newContext()).newPage();
    await d.goto(B);
    await d.waitForTimeout(800);
    check(!(await d.locator("[role=region][aria-label='Install the app']").isVisible().catch(() => false)), "no banner on desktop");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
