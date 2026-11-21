/**
 * Inactivity sign-out: admin after 8 minutes, customers after 20 (server check + browser timer).
 * Time is simulated by back-dating the last-activity cookie.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/idle-signout.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
// Back-date the last-activity time exactly as the site writes it (same cookie, from the page).
// (Waits until the page has started, because the timer marks "active now" when it starts.)
const backdate = async (page, minutes) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await page.evaluate((t) => { document.cookie = `abiye_active=${t}; path=/; max-age=86400; samesite=lax`; }, Date.now() - minutes * 60_000);
};

(async () => {
  execSync(`psql -q "${DB}" -c "delete from rate_limits"`);
  const b = await chromium.launch();
  try {
    // ---- admin: 7 minutes idle → still signed in; 9 minutes → signed out
    const actx = await b.newContext();
    const a = await actx.newPage();
    await adminLogin(a, B, OWNER.email, OWNER.password);
    const active = (await actx.cookies()).find((c) => c.name === "abiye_active");
    check(!!active && !active.httpOnly && (await actx.cookies()).some((c) => c.name === "abiye_sid" && c.httpOnly), "activity is tracked for the signed-in admin");
    await backdate(a, 7);
    await a.goto(`${B}/admin/orders`);
    check(new URL(a.url()).pathname === "/admin/orders", "7 minutes idle: still signed in");
    await backdate(a, 9);
    await a.goto(`${B}/admin/orders`);
    check(new URL(a.url()).pathname === "/admin/login" && new URL(a.url()).searchParams.get("reason") === "idle", "9 minutes idle: signed out (server)");
    check((await a.locator("main").innerText()).includes("signed out after 8 minutes of inactivity"), "admin sees why");
    await a.goto(`${B}/admin`);
    check(new URL(a.url()).pathname === "/admin/login", "the old session no longer works");

    // ---- admin: browser timer in an open tab
    const t = await (await b.newContext()).newPage();
    await adminLogin(t, B, OWNER.email, OWNER.password);
    await t.goto(`${B}/admin/orders`);
    await backdate(t, 8.1);
    await t.waitForURL(/\/admin\/login\?reason=idle/, { timeout: 20000 });
    check(true, "open admin tab signs itself out after 8 minutes without activity");

    // ---- a new sign-in is not affected by an old activity time
    const n = await (await b.newContext()).newPage();
    await n.context().addCookies([{ name: "abiye_active", value: String(Date.now() - 60 * 60_000), url: B }, { name: "abiye_sid", value: "old-session", url: B }]);
    await adminLogin(n, B, OWNER.email, OWNER.password);
    await n.goto(`${B}/admin/orders`);
    check(new URL(n.url()).pathname === "/admin/orders", "fresh sign-in starts a new inactivity count");

    // ---- customer: 19 minutes ok, 21 minutes signed out (returns to the page after signing in)
    const email = `idle-${RUN}@example.com`;
    await ensureCustomer(email, "IdleE2E2026x");
    const cctx = await b.newContext();
    const c = await cctx.newPage();
    await loginCustomer(c, B, email, "IdleE2E2026x");
    await c.goto(`${B}/account`);
    await backdate(c, 19);
    await c.goto(`${B}/account`);
    check(new URL(c.url()).pathname === "/account", "customer 19 minutes idle: still signed in");
    await backdate(c, 21);
    await c.goto(`${B}/account/wallet`);
    const u = new URL(c.url());
    check(u.pathname === "/account/login" && u.searchParams.get("reason") === "idle" && u.searchParams.get("next") === "/account/wallet", "customer 21 minutes idle: signed out, comes back to the page after signing in");
    check((await c.locator("main").innerText()).includes("signed out after 20 minutes of inactivity"), "customer sees why");

    // ---- reopening the app hours later (home page, not a protected page): signed out, not "activity"
    const h = await (await b.newContext()).newPage();
    await loginCustomer(h, B, email, "IdleE2E2026x");
    await h.goto(`${B}/account`);
    await h.context().addCookies([{ name: "abiye_active", value: String(Date.now() - 5 * 3600_000), url: B }]);
    await h.goto(`${B}/`);
    await h.mouse.move(10, 10);
    await h.waitForURL(/\/account\/login\?reason=idle/, { timeout: 15000 });
    await h.goto(`${B}/account`);
    check(new URL(h.url()).pathname === "/account/login", "opened again after 5 hours: signed out (the visit does not count as activity)");

    // ---- warning one minute before (admin tab)
    const w = await (await b.newContext()).newPage();
    await adminLogin(w, B, OWNER.email, OWNER.password);
    await w.goto(`${B}/admin/orders`);
    await backdate(w, 7.2);
    await w.waitForSelector("[data-sonner-toast]:has-text('signed out in 1 minute')", { timeout: 20000 });
    await w.click("[data-sonner-toast] button:has-text('Stay signed in')");
    await w.waitForTimeout(6000);
    check(new URL(w.url()).pathname === "/admin/orders", "warning with “Stay signed in” keeps the session");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
