/**
 * Staff/admin accounts cannot use the customer side; staff password reset still works.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/staff-portal.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin, passMfa } = require("./_admin.cjs");
const { ensureCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const MAIL = "http://127.0.0.1:54324";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resetLink(to) {
  for (let i = 0; i < 40; i++) {
    const found = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    for (const m of found.messages ?? []) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      const href = full.HTML.match(/href="([^"]*\/auth\/confirm[^"]*type=recovery[^"]*)"/)?.[1];
      if (href) return href.replace(/&amp;/g, "&");
    }
    await sleep(500);
  }
  throw new Error("no reset email");
}

(async () => {
  sql("delete from rate_limits");
  const email = `staff-portal-${RUN}@example.com`;
  const pw = "StaffPortal2026x";
  const id = await ensureCustomer(email, pw);
  sql(`insert into profiles (id, full_name, role_id) select '${id}', 'Portal Staff', id from admin_roles where key = 'staff'`);
  const b = await chromium.launch();
  try {
    // customer sign-in refused
    const p = await (await b.newContext()).newPage();
    await p.goto(`${B}/account/login`);
    await p.fill("#email", email);
    await p.fill("#password", pw);
    await p.click("form button[type=submit]");
    await p.waitForSelector("form [role=alert]");
    check((await p.locator("form [role=alert]").innerText()).includes("staff account"), "staff cannot sign in to the customer portal");
    await p.goto(`${B}/account`);
    check(new URL(p.url()).pathname === "/account/login", "and are not left signed in");

    // signed in to the dashboard: the shop does not treat them as a customer
    const a = await (await b.newContext()).newPage();
    await adminLogin(a, B, email, pw);
    await a.goto(`${B}/account`);
    check(new URL(a.url()).pathname === "/account/login", "admin session is not a customer session (My account → sign-in)");
    await a.goto(`${B}/checkout`);
    check(new URL(a.url()).pathname === "/account/login", "admin session cannot check out");

    // password reset from the website still works for staff
    const r = await (await b.newContext()).newPage();
    await r.goto(`${B}/account/forgot-password`);
    await r.fill("#email", email);
    await r.click("form button[type=submit]");
    await r.goto(await resetLink(email));
    check(new URL(r.url()).pathname === "/account/reset-password", "staff reset link opens the new-password page");
    await r.fill("#password", "StaffPortalNew2026");
    await r.fill("#confirm", "StaffPortalNew2026");
    await r.click("form button[type=submit]");
    // Staff with two-step login confirm their authenticator code first, then choose the password.
    await r.waitForURL((u) => u.pathname.startsWith("/admin/mfa"), { timeout: 15000 });
    check(true, "two-step login is required before changing a staff password");
    await passMfa(r, email);
    check(new URL(r.url()).pathname === "/account/reset-password", "after the code, back to the new-password page");
    await r.fill("#password", "StaffPortalNew2026");
    await r.fill("#confirm", "StaffPortalNew2026");
    await r.click("form button[type=submit]");
    await r.waitForURL((u) => u.pathname === "/admin", { timeout: 15000 });
    check(true, "password changed; staff land in the dashboard");
    const n = await (await b.newContext()).newPage();
    await adminLogin(n, B, email, "StaffPortalNew2026");
    check(new URL(n.url()).pathname === "/admin", "the new password works");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
    sql(`update profiles set is_active = false where id = '${id}'`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
