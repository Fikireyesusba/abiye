/**
 * Member ID (6 random letters/digits for customers and staff) and Track order for signed-in customers only.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/member-id.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);

(async () => {
  sql("delete from rate_limits where true");
  const email = `member-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "MemberE2E2026x");
  const mid = sql(`select member_id from customer_accounts where id = '${uid}'`);
  check(/^[A-HJKMNP-Z2-9]{6}$/.test(mid), `new customer got a member ID (${mid})`);
  const b = await chromium.launch();
  try {
    // ---- signed out: track order asks to sign in
    const anon = await (await b.newContext()).newPage();
    await anon.goto(`${B}/track-order`);
    check(new URL(anon.url()).pathname === "/account/login", "track order: signed-out visitors are sent to sign in");

    // ---- customer sees their ID on My account
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "MemberE2E2026x");
    await c.goto(`${B}/account`);
    check((await c.locator("[data-testid=member-id]").innerText()).trim() === mid, "My account shows the member ID");
    await c.goto(`${B}/track-order`);
    check(new URL(c.url()).pathname === "/track-order" && await c.locator("#orderNumber").count() === 1 && await c.locator("#trackingCode").count() === 0,
      "signed in: track by order number only");
    await c.fill("#orderNumber", "ET-99999999");
    await c.click("button[type=submit]");
    await c.waitForSelector("text=None of your orders");
    check(true, "unknown order number: not found");

    // ---- admin: list, search by ID, customer page, staff list
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/customers?q=${mid.toLowerCase()}`);
    const rows = o.locator("tbody tr");
    check(await rows.count() === 1 && (await rows.first().innerText()).includes(email) && (await rows.first().innerText()).includes(mid),
      "customers: search by member ID finds exactly that customer, ID shown");
    await o.goto(`${B}/admin/customers/${uid}`);
    check((await o.locator("main").innerText()).includes(`Member ID ${mid}`), "customer page shows the member ID");
    await o.goto(`${B}/admin/staff`);
    const ownerMid = sql("select a.member_id from customer_accounts a join auth.users u on u.id = a.id where u.email = 'owner@abiye.local'");
    check(/^[A-HJKMNP-Z2-9]{6}$/.test(ownerMid) && (await o.locator("main").innerText()).includes(`ID ${ownerMid}`), `staff list shows staff member IDs (${ownerMid})`);
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
