/**
 * Manage services: pausing a service shows "temporarily unavailable" and the database refuses it.
 * Also: a single failed sign-in is an active (red) security alert; blocked emails are refused quietly.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/services.smoke.cjs
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
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";

(async () => {
  sql("delete from rate_limits; update website_settings set value = value || '{\"shop\": true, \"printing\": true, \"wallet\": true, \"reviews\": true, \"signup\": true}' where key = 'services'");
  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/services`);
    check(await o.locator("aside a[href='/admin/services']").count() === 1 && await o.locator("[data-service]").count() === 5, "Manage services section with 5 services");
    await o.uncheck("#svc-printing");
    await o.uncheck("#svc-shop");
    await o.fill("#note_en", `Back on Monday ${RUN}`);
    await o.click("button:has-text('Save')");
    await o.waitForSelector("[data-sonner-toast]:has-text('Settings saved')");
    check(sql("select (value->>'printing') || (value->>'shop') from website_settings where key = 'services'") === "falsefalse", "printing and shop paused");

    const email = `svc-${RUN}@example.com`;
    await ensureCustomer(email, "ServiceE2E2026x");
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "ServiceE2E2026x");
    await c.goto(`${B}/printing`);
    check(await c.locator("[data-service-off=printing]").count() === 1 && (await c.locator("main").innerText()).includes(`Back on Monday ${RUN}`), "printing page: temporarily unavailable, with the message");
    check(await c.locator("#print-files").count() === 0, "no upload form while printing is paused");
    await c.goto(`${B}/shop`);
    check(await c.locator("[data-service-off=shop]").count() === 1 && await c.locator("article button:has-text('Add to basket')").count() === 0, "shop: notice and no Add to basket buttons");
    await c.goto(`${B}/products/sample-usb-c-fast-charger`);
    check(await c.locator("main button:has-text('Add to basket')").count() === 0 && await c.locator("[data-service-off=shop]").count() === 1, "product page: no Add to basket");
    let refused = false;
    try {
      sql(`set role service_role; select public.create_order_for_user('${sql(`select id from auth.users where email = '${email}'`)}', jsonb_build_object('idempotency_key', gen_random_uuid(),
        'access_token_hash', encode(sha256('x${RUN}'::bytea),'hex'), 'tracking_code_hash', encode(sha256('y${RUN}'::bytea),'hex'),
        'customer', jsonb_build_object('full_name', 'Svc Buyer', 'phone', '+251911223399'), 'fulfillment', jsonb_build_object('method', 'pickup'),
        'items', jsonb_build_array(jsonb_build_object('type', 'product', 'product_id', '20000000-0000-0000-0000-000000000007', 'quantity', 1))))`);
    } catch (e) { refused = /service_unavailable/.test(String(e.stderr ?? e.message)); }
    check(refused, "the database refuses a product order while the shop is paused");

    // back on
    await o.goto(`${B}/admin/services`);
    await o.check("#svc-printing");
    await o.check("#svc-shop");
    await o.fill("#note_en", "");
    await o.click("button:has-text('Save')");
    await o.waitForSelector("[data-sonner-toast]:has-text('Settings saved')");
    await c.goto(`${B}/printing`);
    check(await c.locator("[data-service-off]").count() === 0 && await c.locator("#print-files").count() === 1, "back on: printing form is back");

    // sign-ups paused
    sql("update website_settings set value = value || '{\"signup\": false}' where key = 'services'");
    const v = await (await b.newContext()).newPage();
    await v.goto(`${B}/`);
    check(await v.locator("a[href='/account/signup']").count() === 0, "home: no Create account while sign-ups are paused");
    await v.goto(`${B}/account/signup`);
    check(await v.locator("[data-service-off=signup]").count() === 1 && await v.locator("#password").count() === 0, "sign-up page: temporarily unavailable");
    sql("update website_settings set value = value || '{\"signup\": true}' where key = 'services'");
    await v.goto(`${B}/`);
    check(await v.locator("a[href='/account/signup']").count() >= 1, "home: Create account for signed-out visitors");

    // ---- security: one failed sign-in is an active alert; blocked emails refused without an alert
    const typo = `typo-${RUN}@example.com`;
    const q = await (await b.newContext()).newPage();
    await q.goto(`${B}/account/login`);
    await q.fill("#email", typo);
    await q.fill("#password", "wrong-password-1");
    await q.click("form button[type=submit]");
    await q.waitForSelector("form [role=alert]");
    await o.goto(`${B}/admin/security?tab=emails`);
    check(await o.locator(`tr:has-text("${typo}") :text("active alert")`).count() === 1, "one failed sign-in: marked as an active alert (red)");
    check(await o.locator("nav[aria-label=Sections] a:has-text('Suspicious emails') span[aria-label*='active alert']").count() === 1, "red count on the Suspicious emails tab");
    sql(`insert into blocked_emails (email, reason) values ('blocked-${RUN}@example.com', 'test')`);
    const before = Number(sql("select count(*) from security_events"));
    await q.goto(`${B}/account/login`);
    await q.fill("#email", `blocked-${RUN}@example.com`);
    await q.fill("#password", "whatever-123");
    await q.click("form button[type=submit]");
    await q.waitForSelector("form [role=alert]");
    check((await q.locator("form [role=alert]").innerText()).includes("not allowed"), "blocked email: “You're not allowed”");
    check(Number(sql("select count(*) from security_events")) === before, "blocked email: no event, no alert");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    sql("update website_settings set value = value || '{\"shop\": true, \"printing\": true, \"wallet\": true, \"reviews\": true, \"signup\": true, \"note\": {\"en\": \"\", \"am\": \"\"}}' where key = 'services'");
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
