/**
 * Activity log categories: cards with counts; clicking one shows only that category.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/activity-categories.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);

(async () => {
  sql("delete from rate_limits");
  sql(`insert into audit_logs (action, entity_type, entity_id) values ('payment_verified', 'payment_submission', 'pay-${RUN}'),
       ('email_blocked', 'security', 'sec-${RUN}@example.com'), ('update', 'products', 'prod-${RUN}'), ('update', 'bank_accounts', 'bank-${RUN}')`);
  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/activity`);
    check(await o.locator("a[data-category]").count() === 6, "six category cards");
    const main = await o.locator("main").innerText();
    check(main.includes(`pay-${RUN}`) && main.includes(`sec-${RUN}`), "All activity lists everything");
    await o.click("a[data-category=payments]");
    await o.waitForURL(/cat=payments/);
    const pay = await o.locator("table").innerText();
    check(pay.includes(`pay-${RUN}`) && !pay.includes(`sec-${RUN}`) && !pay.includes(`prod-${RUN}`), "Payments card shows payments only");
    await o.click("a[data-category=security]");
    await o.waitForURL(/cat=security/);
    const sec = await o.locator("table").innerText();
    check(sec.includes(`sec-${RUN}`) && !sec.includes(`pay-${RUN}`), "Security card shows security only");
    await o.click("a[data-category=staff]");
    await o.waitForURL(/cat=staff/);
    check((await o.locator("table").innerText()).includes(`bank-${RUN}`), "bank account changes under Staff & settings");
    await o.click("a[data-category=catalog]");
    await o.waitForURL(/cat=catalog/);
    check((await o.locator("table").innerText()).includes(`prod-${RUN}`), "product changes under Products & catalog");
    check(Number((await o.locator("a[data-category=catalog] .text-2xl").innerText()).trim()) >= 1, "cards show counts");
    await o.fill("input[name=q]", `prod-${RUN}`);
    await o.click("button:has-text('Search')");
    check(new URL(o.url()).searchParams.get("cat") === "catalog", "search stays inside the category");
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
