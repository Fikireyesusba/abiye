/**
 * Personal promo codes: admin creates a "selected customers" promotion, gives it
 * by email (Promotions page and customer page), the customer sees it under
 * My account and can use it; another customer cannot.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/personal-promo.smoke.cjs
 */
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const { adminLogin } = require("./_admin.cjs");
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
    op.on("dialog", (d) => d.accept());
    await adminLogin(op, B, OWNER.email, OWNER.password);

    // create two personal promotions
    for (const [code, title] of [[CODE, `VIP ${RUN}`], [CODE2, `Gift ${RUN}`]]) {
      await op.goto(`${B}/admin/promotions?tab=new`);
      await op.fill("#pt-en-new", title);
      await op.fill("#pc-new", code);
      await op.fill("#pdv-new", "20");
      await op.selectOption("#pa-new", "selected");
      await op.check("main form input[name=show_on_homepage]");
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
    await op.waitForSelector("text=Given to 1 customer(s)");
    check(await op.locator(`text=No customer account with: nobody-${RUN.toLowerCase()}@example.com`).count() >= 1, "unknown emails are reported");
    await op.reload();
    check(await op.locator(`text=Selected customers · 1`).count() >= 1, "promotion shows how many customers hold it");
    const vipMember = sql(`select member_id from customer_accounts where id = '${vipId}'`);
    const vipItem = op.locator("li[data-row]", { has: op.locator(`text=VIP ${RUN}`) }).first();
    await vipItem.locator("summary").click();
    check(await vipItem.locator("[data-testid=promo-holder]").innerText().then((t) => t.includes(vipMember) && !t.includes("@")), "holders shown by User ID only");

    // give the second code from the customer's page
    await op.goto(`${B}/admin/customers/${vipId}?tab=promos`);
    await op.selectOption("#give-promo", { label: `${CODE2} — Gift ${RUN}` });
    await op.click("button:has-text('Give code')");
    await toast(op, "Given to 1");
    await op.reload();
    const panel = await op.locator("main").innerText();
    check(panel.includes(CODE) && panel.includes(CODE2), "customer page lists their personal codes");
    await op.goto(`${B}/admin/customers/${vipId}?tab=activity`);
    check((await op.locator("main").innerText()).includes("Personal promo code given"), "timeline records the code");

    // customer sees and uses it
    const cp = await (await b.newContext()).newPage();
    await loginCustomer(cp, B, vip, "VipCustomer2026");
    await cp.goto(`${B}/account/offers`);
    const acc = await cp.locator("main").innerText();
    check(acc.includes(CODE) && acc.includes(CODE2), "customer sees the codes under My offers");
    check(await tryCode(cp, CODE.toLowerCase()) === "applied", "the chosen customer can use the code");
    check(await cp.locator("dl div:has(dt:text-is('Total')) dd").textContent() === "1,360 ETB", "20% discount applied");

    // another customer cannot
    const xp = await (await b.newContext()).newPage();
    await loginCustomer(xp, B, other, "OtherCustomer2026");
    check(await tryCode(xp, CODE) === "error", "another customer cannot use it");
    await xp.goto(`${B}/account/offers`);
    check(!(await xp.locator("main").innerText()).includes(CODE), "another customer does not see it");
    const home = await (await b.newContext()).newPage();
    await home.goto(B);
    check(!(await home.locator("main").innerText()).includes(CODE), "personal codes never appear on the homepage");

    // remove (with a reason)
    await op.goto(`${B}/admin/customers/${vipId}?tab=promos`);
    const row2 = op.locator("li", { hasText: CODE2 });
    await row2.locator("input[name=reason]").fill("Given by mistake");
    await row2.locator("button:has-text('Remove')").click();
    await toast(op, "Code removed");
    check(sql(`select metadata->>'reason' from audit_logs where action = 'promo_unassigned' and entity_id = '${vipId}' order by id desc limit 1`) === "Given by mistake", "removal recorded with the reason");
    await cp.goto(`${B}/account/offers`);
    check(!(await cp.locator("main").innerText()).includes(CODE2), "a removed code disappears for the customer");

    // delete: nobody holds CODE2 any more and it was never used → the Super Admin can delete it
    await op.goto(`${B}/admin/promotions`);
    const giftItem = op.locator("li[data-row]", { has: op.locator(`text=Gift ${RUN}`) }).first();
    await giftItem.locator("summary").click();
    await giftItem.locator("button:has-text('Delete')").click();
    await toast(op, "Promotion deleted");
    check(sql(`select count(*) from promotions where code = '${CODE2}'`) === "0", "unused promotion deleted by the Super Admin");
    // CODE is still held by a customer → remove it from them first
    await op.reload();
    const vip2 = op.locator("li[data-row]", { has: op.locator(`text=VIP ${RUN}`) }).first();
    await vip2.locator("summary").click();
    check(await vip2.locator("text=first remove it from its 1 customer(s)").count() === 1 && await vip2.locator("button:has-text('Delete')").count() === 0,
      "a promotion given to a customer must be removed from them before deleting");

    // revoke with a reason → the code stops working
    await vip2.locator("input[aria-label='Reason for revoking']").fill("Campaign cancelled");
    await vip2.locator("button:has-text('Revoke')").click();
    await toast(op, "Promotion revoked");
    check(sql(`select is_active || ':' || revoked_reason from promotions where code = '${CODE}'`) === "false:Campaign cancelled", "revoked with the reason");
    await op.reload();
    check(await op.locator("li[data-row]", { has: op.locator(`text=VIP ${RUN}`) }).first().locator("[data-testid=promo-revoked]", { hasText: "Campaign cancelled" }).count() === 1,
      "revoked promotion shows the reason");
    await cp.goto(`${B}/account/offers`);
    check(!(await cp.locator("main").innerText()).includes(CODE), "a revoked code disappears for the customer");
    check(await tryCode(cp, CODE) === "error", "a revoked code no longer works at checkout");

    // Excel of codes used (Super Admin): User ID, order, original price, discount, price paid
    // (a real order with a code for everyone, its payment approved)
    sql(`insert into promotions (title_en, title_am, code, discount_type, discount_value) values ('Paid ${RUN}', 'Paid ${RUN}', 'PAID${RUN.toUpperCase()}', 'fixed', 100)`);
    const paid = JSON.parse(sql(`set role service_role; select public.create_order_for_user('${vipId}', jsonb_build_object('idempotency_key', gen_random_uuid(),
      'access_token_hash', encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'tracking_code_hash', encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
      'locale', 'en', 'customer', jsonb_build_object('full_name', 'VIP', 'phone', '+251911223344'), 'fulfillment', jsonb_build_object('method', 'pickup'),
      'items', jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', (select id from products where sku = 'SMP-CH-001'), 'quantity', 1)),
      'promotion_code', 'PAID${RUN.toUpperCase()}'))`).split("\n").pop());
    sql(`update orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = '${paid.order_id}'`);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
    await op.goto(`${B}/admin/promotions`);
    const exp = op.locator("[data-testid=promo-uses-export]");
    await exp.locator("input[name=from]").fill(today);
    await exp.locator("input[name=to]").fill(today);
    const [dl] = await Promise.all([op.waitForEvent("download"), exp.locator("button:has-text('Excel')").click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    const ws = wb.getWorksheet("Promotion uses");
    const heads = ws.getRow(1).values.slice(1);
    const rows = [];
    ws.eachRow((r, i) => { if (i > 1) rows.push(r.values.slice(1)); });
    const expected = Number(sql(`select count(*) from orders where promotion_id is not null and payment_verified_at >= (timestamp '${today} 00:00' at time zone 'Europe/Warsaw')`));
    check(["User ID", "Order", "Promo code", "Original price (ETB)", "Discount (ETB)", "Price after discount (ETB)"].every((h) => heads.includes(h)) && rows.length === expected,
      `promotion uses Excel: User ID, order, original price, discount, price paid (${rows.length} row(s))`);
    const iO = heads.indexOf("Original price (ETB)"), iD = heads.indexOf("Discount (ETB)"), iA = heads.indexOf("Price after discount (ETB)");
    check(rows.every((r) => Math.abs(r[iO] - r[iD] - r[iA]) < 0.01 && /^[1-9][0-9]{5}$/.test(String(r[0]))), "each row: original − discount = price paid, User ID only");
    const mine = rows.find((r) => r[heads.indexOf("Order")] === paid.order_number);
    check(!!mine && String(mine[0]) === vipMember && mine[iD] === 100 && mine[iA] === mine[iO] - 100 && mine[heads.indexOf("Promo code")] === `PAID${RUN.toUpperCase()}`,
      `the paid order is listed: ${paid.order_number}, User ID ${vipMember}, 100 ETB off`);
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
    sql(`update promotions set is_active = false where code in ('${CODE}', '${CODE2}', 'PAID${RUN.toUpperCase()}')`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
