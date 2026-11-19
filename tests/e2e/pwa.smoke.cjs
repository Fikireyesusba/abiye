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
    // Icons come from the business's own images (Admin → Settings): app icon > logo > built-in icon.
    const { execSync } = require("child_process");
    const sql = (q) => execSync(`psql -Atq "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`, { input: q }).toString().trim();
    const before = sql("select value::text from website_settings where key = 'business'");
    const builtIn = await fetch(`${B}/app-icon/512`, { redirect: "manual" });
    const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
    const png = await (await fetch(`${B}/icons/icon-512.png`)).arrayBuffer();
    const path = "branding/0e2e0e2e-0000-4000-8000-000000000001.png";
    await fetch(`${SUPA}/storage/v1/object/site-assets/${path}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "image/png", "x-upsert": "true" }, body: Buffer.from(png) });
    try {
      sql("update website_settings set value = value - 'app_icon_path' - 'logo_path' where key = 'business'");
      const none = await fetch(`${B}/app-icon/512`, { redirect: "manual" });
      check(none.status === 307 && /\/icons\/icon-512\.png$/.test(none.headers.get("location") ?? ""), "no logo uploaded: built-in brand icon");
      sql(`update website_settings set value = value || '{"logo_path":"${path}"}' where key = 'business'`);
      const fromLogo = await fetch(`${B}/app-icon/512`);
      check(fromLogo.ok && fromLogo.headers.get("content-type") === "image/png", "logo uploaded: icon drawn from the logo");
      sql(`update website_settings set value = value || '{"app_icon_path":"${path}"}' where key = 'business'`);
      const fromIcon = await fetch(`${B}/app-icon/180`);
      check(fromIcon.ok && fromIcon.headers.get("content-type") === "image/png", "app icon uploaded: used for the iPhone icon");
    } finally {
      sql(`update website_settings set value = '${before.replace(/'/g, "''")}'::jsonb where key = 'business'`);
    }
    void builtIn;
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
    check((await ip.locator("link[rel='apple-touch-icon']").getAttribute("href")) === "/app-icon/180", "iPhone home-screen icon");
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
