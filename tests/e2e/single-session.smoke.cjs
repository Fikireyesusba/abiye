/**
 * One device per account: signing in somewhere else signs the first browser out
 * (customers and staff), with an explanation on the login page.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/single-session.smoke.cjs
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
const sql = (q) => execSync(`psql -Atq "${DB}" -c "${q.replace(/"/g, '\\"')}"`).toString().trim();

(async () => {
  sql("delete from rate_limits");
  const b = await chromium.launch();
  try {
    // ---- customer
    const email = `one-device-${RUN}@example.com`;
    await ensureCustomer(email, "OneDevice2026x");
    const phone = await (await b.newContext()).newPage();
    await loginCustomer(phone, B, email, "OneDevice2026x");
    check(new URL(phone.url()).pathname === "/account", "signed in on device 1");
    const laptop = await (await b.newContext()).newPage();
    await loginCustomer(laptop, B, email, "OneDevice2026x");
    check(new URL(laptop.url()).pathname === "/account", "signed in on device 2");
    const uid = sql(`select id from auth.users where email = '${email}'`);
    check(sql(`select count(*) from auth.sessions where user_id = '${uid}'`) === "1", "only one open session for the account");
    await phone.goto(`${B}/account`);
    check(phone.url().includes("/account/login") && phone.url().includes("reason=elsewhere"), `device 1 is signed out on its next page (${phone.url()})`);
    check((await phone.locator("[role=status]").innerText()).includes("another device"), "device 1 is told why");
    await laptop.goto(`${B}/account`);
    check(new URL(laptop.url()).pathname === "/account", "device 2 stays signed in");

    // ---- staff (after the two-step code)
    const a1 = await (await b.newContext()).newPage();
    await adminLogin(a1, B, OWNER.email, OWNER.password);
    check(new URL(a1.url()).pathname.startsWith("/admin") && !a1.url().includes("login"), "admin signed in on browser 1");
    const a2 = await (await b.newContext()).newPage();
    await adminLogin(a2, B, OWNER.email, OWNER.password);
    await a1.goto(`${B}/admin/orders`);
    check(a1.url().includes("/admin/login?reason=elsewhere"), `admin browser 1 signed out (${a1.url()})`);
    check((await a1.locator("[role=status]").innerText()).includes("another device"), "admin is told why");
    await a2.goto(`${B}/admin/orders`);
    check(new URL(a2.url()).pathname === "/admin/orders", "admin browser 2 keeps working");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    await b.close();
  }
  console.log(results.join("\n"));
  console.log(`${results.filter((r) => r.startsWith("ok")).length}/${results.length} passed`);
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
