/**
 * Admin two-step login (authenticator app): set-up on first sign-in, code on
 * later sign-ins, password-only sessions get no admin access (app + database
 * API), Super Admin reset for a lost phone, customers unaffected.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/mfa.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin, nextCode, resetFactors } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });

async function passwordStep(page, email, password) {
  await page.goto(`${B}/admin/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/admin\/mfa/, { timeout: 15000 });
}

(async () => {
  sql("delete from rate_limits");
  const email = `mfa-staff-${RUN}@example.com`;
  const pw = "MfaStaff2026x";
  const staffId = await ensureCustomer(email, pw);
  sql(`insert into profiles (id, full_name, role_id) select '${staffId}', 'MFA Staff ${RUN}', id from admin_roles where key = 'manager'`);
  const b = await chromium.launch();
  try {
    // ---- password only: no admin access anywhere
    const p = await (await b.newContext()).newPage();
    await passwordStep(p, email, pw);
    check(await p.locator("button:has-text('Set up two-step login')").count() === 1, "first sign-in asks to set up an authenticator");
    await p.goto(`${B}/admin/orders`);
    check(new URL(p.url()).pathname === "/admin/mfa", "admin pages redirect to the code step");
    const tok = await (await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw }),
    })).json();
    const api = (path, init = {}) => fetch(`${SUPA}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    check(await (await api("rpc/my_admin_context", { method: "POST", body: "{}" })).json() === null, "database API: password-only token gets no admin context");
    check((await (await api("bank_accounts?select=id")).json()).length === 0, "database API: password-only token cannot read bank accounts");
    check((await (await api("payment_submissions?select=id")).json()).length === 0, "database API: password-only token cannot read payments");

    // ---- set up
    await p.goto(`${B}/admin/mfa`);
    await p.click("button:has-text('Set up two-step login')");
    check(!!(await p.waitForSelector("img[alt^='QR code']", { timeout: 15000 }).catch(() => null)), "QR code shown");
    await p.click("summary:has-text('Enter this key instead')");
    const secret = (await p.locator("p.select-all").textContent()).trim();
    await p.fill("#code", "000000");
    await p.click("form button[type=submit]");
    await p.waitForSelector("form [role=alert]");
    check((await p.locator("form [role=alert]").innerText()).includes("not correct"), "a wrong code is refused");
    const fs = require("fs"), os = require("os"), path = require("path");
    const store = path.join(os.tmpdir(), "abiye-e2e-totp.json");
    const saved = (() => { try { return JSON.parse(fs.readFileSync(store, "utf8")); } catch { return {}; } })();
    fs.writeFileSync(store, JSON.stringify({ ...saved, [email]: secret }));
    await p.fill("#code", await nextCode(email, secret));
    await p.click("form button[type=submit]");
    await p.waitForURL(/\/admin\?mfaEnabled=1/);
    check(await p.locator("text=Two-step login is on").count() === 1, "set-up confirmed; dashboard opens");

    // ---- next sign-in asks for the code
    const p2 = await (await b.newContext()).newPage();
    await passwordStep(p2, email, pw);
    check(await p2.locator("#code").count() === 1 && await p2.locator("button:has-text('Set up')").count() === 0, "later sign-ins ask for the code");
    await p2.fill("#code", "123456");
    await p2.click("form button[type=submit]");
    await p2.waitForSelector("form [role=alert]");
    check(true, "wrong code refused at sign-in");
    await p2.fill("#code", await nextCode(email, secret));
    await p2.click("form button[type=submit]");
    await p2.waitForURL((u) => u.pathname === "/admin");
    check(await p2.locator("h1:has-text('Welcome')").count() === 1, "correct code opens the dashboard");

    // ---- Super Admin resets it (lost phone)
    const o = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/staff`);
    const row = o.locator("tr", { hasText: `MFA Staff ${RUN}` });
    check(await row.locator("text=On").count() >= 1, "Staff page shows two-step login is on");
    await row.locator("button:has-text('Reset')").last().click();
    await toast(o, "Two-step login reset");
    check(sql(`select count(*) from auth.mfa_factors where user_id = '${staffId}'`) === "0", "authenticator removed");
    await o.goto(`${B}/admin/activity?q=mfa_reset`);
    check((await o.locator("table").innerText()).includes("Two-step login reset"), "reset recorded in the Activity log");
    const p3 = await (await b.newContext()).newPage();
    await passwordStep(p3, email, pw);
    check(await p3.locator("button:has-text('Set up two-step login')").count() === 1, "after a reset the staff member sets it up again");
    resetFactors(email);

    // ---- customers are not affected
    const cEmail = `mfa-cust-${RUN}@example.com`;
    await ensureCustomer(cEmail, "MfaCustomer2026");
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, cEmail, "MfaCustomer2026");
    await c.goto(`${B}/account`);
    check(new URL(c.url()).pathname === "/account", "customers sign in without a code");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
    sql(`update profiles set is_active = false where id = '${staffId}'`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
