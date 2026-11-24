/**
 * Partner shops ("Abiye Business"), end to end, with the business address switched on:
 * Super Admin adds a shop and links its staff → customer picks "pick up at a partner shop" at checkout (full address shown)
 * → courier picks up → courier and shop check each other's PIN → customer's PIN at the shop → shop earns, Super Admin pays.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/partner.smoke.cjs
 */
const { chromium } = require("playwright");
const { spawn, execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer, fillIfEditable } = require("./_customer.cjs");

const PORT = 3108;
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const H = { shop: "shop.fantaf.test", ocs: "ocs.fantaf.test", ops: "operations.fantaf.test", courier: "courier.fantaf.test", business: "business.fantaf.test" };
const U = (k) => `http://${H[k]}:${PORT}`;
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ZONE = "40000000-0000-0000-0000-000000000001";

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  sql(`update website_settings set value = value || '{"delivery_discounts": [], "free_delivery_threshold_etb": null}' where key = 'delivery'`);
  const make = async (prefix, role, name) => {
    const email = `${prefix}-${RUN}@example.com`;
    const id = await ensureCustomer(email, "PartnerE2E2026x");
    sql(`insert into profiles (id, full_name, role_id) select '${id}', '${name}', id from admin_roles where key = '${role}'`);
    return { email, id };
  };
  const courier = await make("pcourier", "courier", "Partner Run Courier");
  const clerk = await make("clerk", "partner", `Shop Clerk ${RUN}`);
  const mgr = await make("pmgr", "manager", "Partner Manager");
  const custEmail = `pcust-${RUN}@example.com`;
  await ensureCustomer(custEmail, "CustomerE2E2026x");
  const shopName = `Hawassa Corner ${RUN}`;
  const fee = sql(`select fee_etb from delivery_zones where id = '${ZONE}'`);
  const charger = sql("select id from products where sku = 'SMP-CH-001'");

  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, CUSTOMER_HOST: H.shop, STAFF_HOST: H.ocs, SUPER_ADMIN_HOST: H.ops, COURIER_HOST: H.courier, BUSINESS_HOST: H.business },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  if (process.env.E2E_SERVER_LOG) { const f = require("fs").createWriteStream(process.env.E2E_SERVER_LOG); app.stdout.pipe(f); app.stderr.pipe(f); }
  const b = await chromium.launch({ args: ["--host-resolver-rules=MAP *.fantaf.test 127.0.0.1"] });
  const fresh = async (mobile) => (await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 1000 } })).newPage();
  try {
    for (let i = 0; i < 60; i++) { if ((await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null))?.ok) break; await sleep(500); }

    // ---- Super Admin: add the shop, link the clerk
    const o = await fresh();
    await adminLogin(o, U("ops"), OWNER.email, OWNER.password);
    await o.goto(`${U("ops")}/admin/partners?tab=add`);
    await o.fill("#ps-name", shopName);
    await o.selectOption("#ps-zone", ZONE);
    await o.fill("#ps-address", "Piassa, next to the post office, 2nd floor");
    await o.fill("#ps-landmark", "Blue gate");
    await o.fill("#ps-phone", "0462201122");
    await o.fill("#ps-hours", "Mon–Sat 8:00–19:00");
    await o.fill("#ps-fee", "40");
    await o.click("button:has-text('Add shop')");
    await o.waitForURL(/\/admin\/partners\/[0-9a-f-]{36}\?created=1/, { timeout: 15000 });
    const shopId = new URL(o.url()).pathname.split("/").pop();
    check(sql(`select phone || ' ' || handling_fee_etb from partner_shops where id = '${shopId}'`) === "+251462201122 40.00", "Super Admin adds a partner shop (phone, handling fee)");
    await o.goto(`${U("ops")}/admin/partners?tab=staff`);
    const staffRow = o.locator("[data-testid=partner-staff] li", { hasText: `Shop Clerk ${RUN}` });
    await staffRow.locator("select[name=shopId]").selectOption(shopId);
    await staffRow.locator("button:has-text('Save')").click();
    await toast(o, "Staff member linked");
    check(sql(`select shop_id from partner_staff where profile_id = '${clerk.id}'`) === shopId, "clerk linked to the shop");

    // ---- Business address: only partner shop staff
    const biz = await fresh(true);
    await adminLogin(biz, U("business"), clerk.email, "PartnerE2E2026x", "/business");
    check(new URL(biz.url()).pathname === "/business" && (await biz.locator("[data-testid=business-shop]").innerText()) === shopName, "Business app: the clerk signs in and sees their shop");
    await biz.goto(`${U("business")}/admin/orders`);
    check(new URL(biz.url()).pathname === "/business", "Business address: no admin portal");
    const man = await biz.evaluate(async (u) => (await fetch(u)).json(), `${U("business")}/manifest.webmanifest`);
    check(/Business/.test(man.name) && man.start_url === "/business", `Business address installs its own app ("${man.name}")`);
    const shopPage = await fresh();
    check((await shopPage.goto(`${U("shop")}/business`)).status() === 404, "customer address: no Business app");

    // ---- Customer: checkout → pick up at the partner shop
    const cu = await fresh();
    // http://*.fantaf.test is not a secure origin, so the browser hides crypto.randomUUID (the real site is HTTPS).
    await cu.addInitScript(() => {
      if (!crypto.randomUUID) crypto.randomUUID = () => "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    });
    const pageErrors = [];
    cu.on("pageerror", (e) => pageErrors.push(e.message));
    cu.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text().slice(0, 400)); });
    await loginCustomer(cu, U("shop"), custEmail, "CustomerE2E2026x");
    await cu.evaluate((c) => {
      localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: c, quantity: 1 }]));
      localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "delivery", deliveryZoneId: null }));
    }, charger);
    await cu.goto(`${U("shop")}/checkout`);
    await cu.waitForSelector("text=Order summary");
    await cu.check("label:has-text('partner shop') input[type=radio]");
    await fillIfEditable(cu, "#fullName", "Abebe Kebede");
    await fillIfEditable(cu, "#phone", "0911223355");
    await cu.check("label:has-text('I agree') input[type=checkbox]");
    await cu.click("button[type=submit]");
    await cu.waitForSelector("text=pickup shop is not available");
    check(true, "partner pickup without a shop chosen is refused");
    await cu.selectOption("#partnerShop", shopId);
    const det = await cu.locator("[data-testid=partner-shop-details]").innerText();
    check(det.includes("Piassa, next to the post office, 2nd floor") && det.includes("Blue gate") && det.includes("Mon–Sat") && det.includes("+251462201122"),
      "checkout shows the shop's full address, landmark, hours and phone");
    check((await cu.locator("dl div:has(dt:text-is('Delivery')) dd").innerText()).includes(`${Number(fee).toLocaleString("en-US")} ETB`), `checkout: delivery price of the shop's city (${fee} ETB)`);
    await cu.click("button[type=submit]");
    await cu.waitForURL(/\/order-success\//, { timeout: 20000 }).catch(async () => {
      await cu.screenshot({ path: "/tmp/claude-0/-home-user/43b91cff-2268-5ff6-8ef6-b36ff140d408/scratchpad/partner-checkout.png", fullPage: true });
      throw new Error(`checkout did not finish: ${(await cu.locator("[role=alert]").allInnerTexts()).join(" | ")} ${pageErrors.join(" | ")} ${cu.url()}`);
    });
    const orderId = cu.url().split("/order-success/")[1].split("?")[0];
    check(sql(`select fulfillment_method || ' ' || (partner_shop_id = '${shopId}') || ' ' || delivery_fee_etb from orders where id = '${orderId}'`) === `pickup true ${fee}`,
      "order placed: pickup at the partner shop, city delivery price");
    check((await cu.locator("[data-testid=order-partner-shop]").innerText()).includes("Piassa"), "order page shows the pickup shop's address");
    const orderNo = sql(`select order_number from orders where id = '${orderId}'`);
    sql(`update orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = '${orderId}'`);

    // ---- Dispatch: manager assigns the courier
    const m = await fresh();
    await adminLogin(m, U("ocs"), mgr.email, "PartnerE2E2026x");
    await m.goto(`${U("ocs")}/admin/couriers?tab=dispatch`);
    const row = m.locator("[data-testid=dispatch-list] li", { hasText: orderNo });
    check((await row.innerText()).includes(`to partner shop ${shopName}`), "Dispatch: the order goes to the partner shop");
    await row.locator("select[name=courier]").selectOption(courier.id);
    await row.locator("button:has-text('Assign')").click();
    await toast(m, "Courier assigned");
    await biz.goto(`${U("business")}/business`);
    check((await biz.locator("[data-testid=expected-order]", { hasText: orderNo }).count()) === 1, "Business app: order listed as coming soon");

    // ---- Courier: picks up, sees the shop (not the customer)
    const c = await fresh(true);
    await adminLogin(c, U("courier"), courier.email, "PartnerE2E2026x", "/courier");
    const card = c.locator("[data-testid=delivery]", { hasText: orderNo });
    const text = await card.innerText();
    const custName = sql(`select customer_name from orders where id = '${orderId}'`);
    check(text.includes(`Take it to: ${shopName}`) && text.includes(`Customer: ${custName}`) && !text.includes("Charger") && !text.includes("ETB"),
      "courier sees the partner shop and the customer name — no products or prices");
    await card.locator("button:has-text('Picked up')").click();
    await toast(c, "Picked up");
    const courierPin = (await c.locator("[data-testid=delivery]", { hasText: orderNo }).locator("[data-testid=courier-handoff-pin]").innerText()).trim();
    check(/^\d{4}$/.test(courierPin), "courier app shows the hand-over PIN for the shop");

    // ---- Shop: enters the courier's PIN (wrong, then right) and shows its own PIN
    await biz.goto(`${U("business")}/business`);
    const inc = biz.locator("[data-testid=incoming-order]", { hasText: orderNo });
    const shopPin = (await inc.locator("[data-testid=shop-pin] p.font-mono").innerText()).trim();
    const incText = await inc.innerText();
    check(incText.includes(custName) && !incText.includes("Charger") && !incText.includes("ETB"), "Business app: order number and customer name only — no products or prices");
    await inc.locator("input[name=code]").fill(courierPin === "0000" ? "1111" : "0000");
    await inc.locator("button:has-text('Received')").click();
    await toast(biz, "That PIN is not right");
    await inc.locator("input[name=code]").fill(courierPin);
    await inc.locator("button:has-text('Received')").click();
    await toast(biz, "Courier's PIN checked");
    check(sql(`select status from orders where id = '${orderId}'`) === "out_for_delivery", "half done: the courier still has to enter the shop's PIN");

    // ---- Courier: enters the shop's PIN → at the shop
    await c.reload();
    const card2 = c.locator("[data-testid=delivery]", { hasText: orderNo });
    await card2.locator("input[name=code]").fill(shopPin);
    await card2.locator("button:has-text('Handed to shop')").click();
    await toast(c, "Shop PIN checked");
    check(sql(`select status || ' ' || (at_shop_at is not null) from orders where id = '${orderId}'`) === "ready_for_pickup true", "PINs checked both ways: order at the shop");
    check(Number(sql(`select amount_etb from courier_earnings where order_id = '${orderId}'`)) === Number(fee), "courier earned the city price at the hand-over");

    // ---- Customer: pickup PIN on the order page
    await cu.goto(`${U("shop")}/order-success/${orderId}`);
    const pin = (await cu.locator("[data-testid=pickup-code] p.font-mono").innerText()).trim();
    check(pin === sql(`select delivery_code from orders where id = '${orderId}'`), "customer sees their pickup PIN once the order is at the shop");

    // ---- Shop: customer comes, PIN → handed over
    await biz.goto(`${U("business")}/business`);
    const at = biz.locator("[data-testid=at-shop-order]", { hasText: orderNo });
    check((await at.innerText()).includes("Abebe") || (await at.innerText()).includes("E2E Customer"), "Business app: waiting order shows the customer's name");
    await at.locator("input[name=code]").fill(pin);
    await at.locator("button:has-text('Handed over')").click();
    await toast(biz, "Handed over to the customer");
    check(sql(`select status from orders where id = '${orderId}'`) === "completed", "customer's PIN checked: order completed");
    await biz.goto(`${U("business")}/business/earnings`);
    check((await biz.locator("[data-testid=business-earnings-list]").innerText()).includes(orderNo), "Business app: Earnings lists the order (handling fee, unpaid)");

    // ---- Super Admin: pay the shop, Excel
    await o.goto(`${U("ops")}/admin/partners/${shopId}`);
    check((await o.locator("[data-testid=partner-unpaid]").innerText()).includes(orderNo), "Super Admin: the shop's unpaid order");
    o.on("dialog", (d) => d.accept());
    await o.fill("input[name=reference]", "BANK-77");
    await o.click("button:has-text('as paid')");
    await toast(o, "Payment of 40 ETB");
    check(sql(`select count(*) || ':' || sum(amount_etb) from partner_payouts where shop_id = '${shopId}'`) === "1:40.00", "shop payment recorded");
    const xl = await o.evaluate(async (u) => { const r = await fetch(u); return `${r.status} ${r.headers.get("content-type")}`; },
      `${U("ops")}/admin/exports/download?kind=partner_orders&from=2026-01-01&to=2030-12-31&shop=${shopId}`);
    check(xl.startsWith("200 application/vnd.openxmlformats"), "Super Admin downloads the partner shop orders Excel");
    await o.goto(`${U("ops")}/admin/orders/${orderId}`);
    check((await o.locator("[data-testid=handoff-status]").innerText()).includes("PINs checked both ways"), "admin order page: hand-over status");
    await o.goto(`${U("ops")}/admin/delivery-monitor?tab=log&app=business`);
    const log = await o.locator("main").innerText();
    check(log.includes("Wrong PIN entered") && log.includes(orderNo) && log.includes("hand-over PIN"), "Delivery monitor: the Business app's wrong PIN is in the app log");
    await o.goto(`${U("ops")}/admin/delivery-monitor?tab=people`);
    check((await o.locator("[data-testid=monitor-person]", { hasText: `Shop Clerk ${RUN}` }).innerText()).includes(shopName), "Delivery monitor: shop staff with their shop and last activity");
    check(sql(`select string_agg(payload->>'step', ',' order by id) from notifications_outbox where event_type = 'delivery_update' and payload->>'order_id' = '${orderId}'`)
      === "assigned,picked_up,at_shop,collected", "every step announced in the orders & payments Telegram group");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n").slice(0, 6).join(" / ")}`);
  } finally {
    await b.close();
    try { process.kill(-app.pid, "SIGTERM"); } catch {}
    sql(`update profiles set is_active = false where id in ('${courier.id}', '${clerk.id}', '${mgr.id}'); update partner_shops set is_active = false where name = '${shopName}'`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
