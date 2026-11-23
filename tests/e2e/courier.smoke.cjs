/**
 * Separate addresses (customers / staff / Super Admin / couriers) and the courier app, end to end.
 * Starts its own server with the address split switched on; the browser maps *.fantaf.test to this machine.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/courier.smoke.cjs
 */
const { chromium } = require("playwright");
const { spawn, execSync } = require("child_process");
const { adminLogin, nextCode } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const PORT = 3107;
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const H = { shop: "shop.fantaf.test", ocs: "ocs.fantaf.test", ops: "operations.fantaf.test", courier: "courier.fantaf.test" };
const U = (k) => `http://${H[k]}:${PORT}`;
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryLogin(page, base, email, password) {
  await page.goto(`${base}/admin/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=signs in at a different address", { timeout: 15000 }).catch(() => {});
  return (await page.locator("text=signs in at a different address").count()) > 0;
}

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const courierEmail = `courier-${RUN}@example.com`;
  const courierId = await ensureCustomer(courierEmail, "CourierE2E2026x");
  sql(`insert into profiles (id, full_name, role_id) select '${courierId}', 'Test Courier', id from admin_roles where key = 'courier'`);
  const mgrEmail = `mgr-${RUN}@example.com`;
  const mgrId = await ensureCustomer(mgrEmail, "ManagerE2E2026x");
  sql(`insert into profiles (id, full_name, role_id) select '${mgrId}', 'Test Manager', id from admin_roles where key = 'manager'`);
  const custEmail = `deliv-${RUN}@example.com`;
  const custId = await ensureCustomer(custEmail, "CustomerE2E2026x");
  // a paid delivery order for the customer
  const zone = sql("select id from delivery_zones where is_active order by sort_order limit 1");
  const order = JSON.parse(sql(`set role service_role; select public.create_order_for_user('${custId}', jsonb_build_object('idempotency_key', gen_random_uuid(),
    'access_token_hash', encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'tracking_code_hash', encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
    'locale', 'en', 'customer', jsonb_build_object('full_name', 'Delivery Customer', 'phone', '+251911445566'),
    'fulfillment', jsonb_build_object('method', 'delivery', 'delivery_zone_id', '${zone}', 'address_line', 'Bole, House 12', 'instructions', 'Blue gate'),
    'items', jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', (select id from products where sku = 'SMP-CH-001'), 'quantity', 1))))`));
  sql(`update orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = '${order.order_id}'`);

  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, CUSTOMER_HOST: H.shop, STAFF_HOST: H.ocs, SUPER_ADMIN_HOST: H.ops, COURIER_HOST: H.courier },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const b = await chromium.launch({ args: ["--host-resolver-rules=MAP *.fantaf.test 127.0.0.1"] });
  const fresh = async () => (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  try {
    for (let i = 0; i < 60; i++) { if ((await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null))?.ok) break; await sleep(500); }

    // ---- customer address: shop only
    const s = await fresh();
    check((await s.goto(`${U("shop")}/`)).status() === 200, "fantaf.xyz: the shop opens");
    check((await s.goto(`${U("shop")}/admin/login`)).status() === 404 && (await s.goto(`${U("shop")}/courier`)).status() === 404,
      "fantaf.xyz: no admin and no courier app (not found)");

    // ---- staff address: admin only; Super Admin and couriers refused
    const st = await fresh();
    await st.goto(`${U("ocs")}/`);
    check(new URL(st.url()).pathname === "/admin/login", "ocs: opens the admin sign-in (no shop)");
    check(await tryLogin(st, U("ocs"), OWNER.email, OWNER.password), "ocs: a Super Admin cannot sign in here");
    check(await tryLogin(st, U("ocs"), courierEmail, "CourierE2E2026x"), "ocs: a courier cannot sign in here");
    const ops = await fresh();
    check(await tryLogin(ops, U("ops"), mgrEmail, "ManagerE2E2026x"), "operations: a manager cannot sign in here");
    check(sql(`select count(*) from security_events where kind = 'admin_login_not_staff' and metadata->>'where' = 'wrong_address' and created_at > now() - interval '5 minutes'`) >= "3",
      "wrong-address sign-ins are recorded as security events");

    const m = await fresh();
    await adminLogin(m, U("ocs"), mgrEmail, "ManagerE2E2026x");
    check(new URL(m.url()).host === `${H.ocs}:${PORT}` && new URL(m.url()).pathname.startsWith("/admin"), "ocs: a manager signs in");
    await m.goto(`${U("ocs")}/shop`);
    check(new URL(m.url()).pathname === "/admin", "ocs: shop pages are not served (back to the admin)");
    const o = await fresh();
    await adminLogin(o, U("ops"), OWNER.email, OWNER.password);
    check(new URL(o.url()).pathname.startsWith("/admin"), "operations: the Super Admin signs in");

    // ---- courier address: courier app only
    const c = await fresh();
    await adminLogin(c, U("courier"), courierEmail, "CourierE2E2026x", "/courier");
    check(new URL(c.url()).pathname === "/courier", "courier: a courier signs in and lands on their deliveries");
    await c.goto(`${U("courier")}/admin/orders`);
    check(new URL(c.url()).pathname === "/courier", "courier: the admin portal is not available");
    check((await c.locator("text=No deliveries assigned to you right now").count()) === 1, "courier: nothing assigned yet");
    const man = await c.evaluate(async (u) => (await fetch(u)).json(), `${U("courier")}/manifest.webmanifest`);
    check(/Courier/.test(man.name) && man.start_url === "/courier" && man.scope === "/" && man.display === "standalone"
      && man.icons.some((i) => i.purpose === "maskable"), `courier address installs its own app ("${man.name}", opens on the deliveries, sign-in stays in the app)`);
    check(await c.locator('meta[name="apple-mobile-web-app-title"]').getAttribute("content") === "Abiye Courier", "iPhone: Add to Home Screen name is “Abiye Courier”");
    check(await c.evaluate(async (base) => (await fetch(`${base}/sw.js`)).ok && (await fetch(`${base}/offline`)).ok, U("courier")),
      "courier address serves the app's background script and offline page (needed to install)");
    check(await c.locator("[data-testid=courier-install]").count() === 1, "courier app shows the Install card (until installed)");

    // ---- manager assigns the delivery to the courier (ocs)
    await m.goto(`${U("ocs")}/admin/orders/${order.order_id}`);
    const panel = m.locator("[data-testid=courier-panel]");
    await panel.locator("select[name=courier]").selectOption(courierId);
    await panel.locator("button:has-text('Assign courier')").click();
    await toast(m, "Courier assigned");
    const code = sql(`select delivery_code from orders where id = '${order.order_id}'`);
    check(/^\d{4}$/.test(code), "assigned: a 4-digit delivery code is made");

    // ---- courier: sees it, picks it up
    await c.goto(`${U("courier")}/courier`);
    const card = c.locator("[data-testid=delivery]", { hasText: order.order_number });
    const cardText = await card.innerText();
    check(cardText.includes("Bole, House 12") && cardText.includes("Blue gate") && (await card.locator('a[href="tel:+251911445566"]').count()) === 1,
      "courier sees address, note and a call button");
    await card.locator("button:has-text('Picked up')").click();
    await toast(c, "Picked up");
    check(sql(`select status from orders where id = '${order.order_id}'`) === "out_for_delivery", "picked up → out for delivery");

    // ---- customer: the delivery code on their order page (shop address)
    const cu = await fresh();
    await loginCustomer(cu, U("shop"), custEmail, "CustomerE2E2026x");
    await cu.goto(`${U("shop")}/order-success/${order.order_id}`);
    check((await cu.locator("[data-testid=delivery-code]").innerText()).includes(code), "customer sees the delivery code while the order is on its way");

    // ---- courier: wrong code, then the right one
    await c.goto(`${U("courier")}/courier`);
    const card2 = c.locator("[data-testid=delivery]", { hasText: order.order_number });
    await card2.locator("input[name=code]").fill(code === "0000" ? "1111" : "0000");
    await card2.locator("button:has-text('Delivered')").click();
    await toast(c, "That code is not right");
    check(sql(`select delivery_code_tries || ':' || status from orders where id = '${order.order_id}'`) === "1:out_for_delivery", "wrong code: refused (try counted)");
    await card2.locator("input[name=code]").fill(code);
    await card2.locator("button:has-text('Delivered')").click();
    await toast(c, "Delivered");
    check(sql(`select status || ':' || (delivered_at is not null) from orders where id = '${order.order_id}'`) === "completed:true", "right code: delivered → completed");
    await c.reload();
    check(!(await c.locator("main").innerText()).includes("Bole, House 12") && (await c.locator(`text=${order.order_number}`).count()) === 1,
      "after delivery: listed as delivered, address no longer shown");
    check(sql(`select string_agg(payload->>'step', ',' order by id) from notifications_outbox where event_type = 'delivery_update' and payload->>'order_id' = '${order.order_id}'`)
      === "assigned,picked_up,delivered", "every step announced in the orders & payments Telegram group");
    await m.goto(`${U("ocs")}/admin/orders/${order.order_id}`);
    check((await m.locator("[data-testid=courier-panel]").innerText()).includes("customer's code checked"), "admin order page: courier, times and delivery confirmed");

    // ---- change password page (staff / admin / courier): email + current password + code + new password twice
    const sp = await fresh();
    check((await sp.goto(`${U("shop")}/admin/password`)).status() === 404, "fantaf.xyz: no staff password page");
    await sp.goto(`${U("courier")}/admin/password`);
    check(new URL(sp.url()).pathname === "/admin/password", "courier address: the change-password page opens without signing in");
    const secret = JSON.parse(require("fs").readFileSync(require("path").join(require("os").tmpdir(), "abiye-e2e-totp.json"), "utf8"))[mgrEmail];
    const fillPw = async (code, next) => {
      await sp.goto(`${U("ocs")}/admin/password`);
      await sp.fill("#pc-email", mgrEmail);
      await sp.fill("#pc-current", "ManagerE2E2026x");
      await sp.fill("#pc-code", code);
      await sp.fill("#pc-new", next);
      await sp.fill("#pc-confirm", next);
      await sp.click("button:has-text('Save changes')");
    };
    await fillPw("000000", "NewManager2026xY");
    await sp.waitForSelector("form [role=alert]");
    check((await sp.locator("form [role=alert]").innerText()).includes("not correct"), "wrong authenticator code: password not changed");
    await fillPw(await nextCode(mgrEmail, secret), "NewManager2026xY");
    await sp.waitForSelector("[data-testid=password-changed]", { timeout: 20000 });
    check(true, "right code: Done — password changed");
    await m.goto(`${U("ocs")}/admin/orders`);
    check(new URL(m.url()).pathname === "/admin/login", "the manager's open session was signed out everywhere");
    check(await tryLogin(sp, U("ocs"), mgrEmail, "ManagerE2E2026x") === false && (await sp.locator("text=Incorrect email or password").count()) === 1,
      "the old password no longer works");
    await adminLogin(sp, U("ocs"), mgrEmail, "NewManager2026xY");
    check(new URL(sp.url()).pathname.startsWith("/admin") && !new URL(sp.url()).pathname.startsWith("/admin/login"), "the new password works");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    await b.close();
    try { process.kill(-app.pid, "SIGTERM"); } catch {}
    sql(`update profiles set is_active = false where id in ('${courierId}', '${mgrId}')`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
