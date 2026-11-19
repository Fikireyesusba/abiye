/**
 * Personal promo codes: admin creates a "selected customers" promotion, gives it
 * by email (Promotions page and customer page), the customer sees it under
 * My account and can use it; another customer cannot.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/personal-promo.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36).toUpperCase();
const CODE = `VIP${RUN}`.slice(0, 20);
const CODE2 = `GIFT${RUN}`.slice(0, 20);
const CHARGER = "20000000-0000-0000-0000-000000000007";
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });

async function tryCode(page, code) {
  await page.evaluate((c) => {
    localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: c, quantity: 2 }]));
    localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "pickup", deliveryZoneId: null }));
  }, CHARGER);
  await page.goto(`${B}/checkout`);
  await page.waitForSelector("text=Order summary");
  await page.fill("#promo", code);
  await page.click("button:has-text('Apply')");
  await page.waitForSelector(`#promo-error, :text("${code} applied")`);
  return (await page.locator("#promo-error").count()) ? "error" : "applied";
}

(async () => {
  sql("delete from rate_limits");
  const vip = `vip-${RUN.toLowerCase()}@example.com`;
  const other = `other-${RUN.toLowerCase()}@example.com`;
  const vipId = await ensureCustomer(vip, "VipCustomer2026");
  await ensureCustomer(other, "OtherCustomer2026");
  const b = await chromium.launch();
  try {
    const op = await (await b.newContext()).newPage();
    await op.goto(`${B}/admin/login`);
    await op.fill("#email", OWNER.email);
    await op.fill("#password", OWNER.password);
    await op.click("button[type=submit]");
    await op.waitForURL((u) => !u.pathname.startsWith("/admin/login"));

    // create two personal promotions
    for (const [code, title] of [[CODE, `VIP ${RUN}`], [CODE2, `Gift ${RUN}`]]) {
      await op.goto(`${B}/admin/promotions`);
      await op.click("summary:has-text('New promotion')");
      await op.fill("#pt-en-new", title);
      await op.fill("#pt-am-new", "የግል ቅናሽ");
      await op.fill("#pc-new", code);
      await op.fill("#pdv-new", "20");
      await op.check("details[open] input[name=restricted]");
      await op.check("details[open] input[name=show_on_homepage]");
      await op.click("button:has-text('Create promotion')");
      await toast(op, "Promotion created");
    }
    check(sql(`select restricted || ':' || show_on_homepage from promotions where code = '${CODE}'`) === "true:false", "personal promotion saved and kept off the homepage");

    // give it by email from the Promotions page
    await op.goto(`${B}/admin/promotions`);
    const item = op.locator("li", { has: op.locator(`text=VIP ${RUN}`) }).first();
    await item.locator("summary").click();
    await item.locator("textarea[name=emails]").fill(`${vip.toUpperCase()}\nnobody-${RUN.toLowerCase()}@example.com`);
    await item.locator("button:has-text('Give code')").click();
    await op.waitForSelector("text=Given to 1 customer(s).");
    check(await op.locator(`text=No account with: nobody-${RUN.toLowerCase()}@example.com`).count() >= 1, "unknown emails are reported");
    await op.reload();
    check(await op.locator(`text=Personal · 1 customer(s)`).count() >= 1, "promotion shows how many customers hold it");

    // give the second code from the customer's page
    await op.goto(`${B}/admin/customers/${vipId}`);
    await op.selectOption("#give-promo", { label: `${CODE2} — Gift ${RUN}` });
    await op.click("button:has-text('Give code')");
    await toast(op, "Given to 1");
    await op.reload();
    const panel = await op.locator("main").innerText();
    check(panel.includes(CODE) && panel.includes(CODE2), "customer page lists their personal codes");
    check(panel.includes("Personal promo code given"), "timeline records the code");

    // customer sees and uses it
    const cp = await (await b.newContext()).newPage();
    await loginCustomer(cp, B, vip, "VipCustomer2026");
    await cp.goto(`${B}/account`);
    const acc = await cp.locator("main").innerText();
    check(acc.includes(CODE) && acc.includes(CODE2), "customer sees the codes under My offers");
    check(await tryCode(cp, CODE.toLowerCase()) === "applied", "the chosen customer can use the code");
    check(await cp.locator("dl div:has(dt:text-is('Total')) dd").textContent() === "1,360 ETB", "20% discount applied");

    // another customer cannot
    const xp = await (await b.newContext()).newPage();
    await loginCustomer(xp, B, other, "OtherCustomer2026");
    check(await tryCode(xp, CODE) === "error", "another customer cannot use it");
    await xp.goto(`${B}/account`);
    check(!(await xp.locator("main").innerText()).includes(CODE), "another customer does not see it");
    const home = await (await b.newContext()).newPage();
    await home.goto(B);
    check(!(await home.locator("main").innerText()).includes(CODE), "personal codes never appear on the homepage");

    // remove
    await op.goto(`${B}/admin/customers/${vipId}`);
    await op.locator("li", { hasText: CODE2 }).locator("button:has-text('Remove')").click();
    await toast(op, "Code removed");
    await cp.goto(`${B}/account`);
    check(!(await cp.locator("main").innerText()).includes(CODE2), "a removed code disappears for the customer");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
    sql(`update promotions set is_active = false where code in ('${CODE}', '${CODE2}')`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
