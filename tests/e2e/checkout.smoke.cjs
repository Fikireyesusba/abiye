/**
 * Checkout → bank transfer → receipt → review → tracking, in a real browser
 * against LOCAL Supabase (`npx supabase start`) and the app on BASE_URL.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/checkout.smoke.cjs
 * Mutates the local database (creates orders). Never point it at production.
 */
const { chromium } = require("playwright");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);

const PERFUME = "20000000-0000-0000-0000-000000000001";
const CHARGER = "20000000-0000-0000-0000-000000000007";
const MANAGER = "eeeeeeee-0000-0000-0000-000000000002";

// Test files: a real PNG (1x1) and an HTML file pretending to be a PNG.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-"));
const realPng = path.join(tmp, "receipt.png");
fs.writeFileSync(realPng, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const fakePng = path.join(tmp, "evil.png");
fs.writeFileSync(fakePng, "<html><script>alert(1)</script></html>".padEnd(200, " "));

// Repeatable runs: other suites reserve sample stock, so restore the seeded levels (LOCAL database only).
function resetSampleStock() {
  if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
  require("child_process").execSync(`psql -Atq -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`, {
    input: `update products p set stock_quantity = v.q from (values ('SMP-PF-001',15),('SMP-PF-002',40),('SMP-SK-001',3),('SMP-MK-001',60),
      ('SMP-HC-001',0),('SMP-PH-001',5),('SMP-CH-001',80),('SMP-EP-001',25),('SMP-PB-001',12),('SMP-CB-001',200)) v(sku,q) where p.sku = v.sku;
      delete from rate_limits;`,
  });
}

(async () => {
  resetSampleStock();
  sql("delete from rate_limits");
  sql(`insert into auth.users (id, email) values ('${MANAGER}', 'e2e-manager@test.local') on conflict do nothing`);
  sql(`insert into profiles (id, full_name, role_id) select '${MANAGER}', 'E2E Manager', id from admin_roles where key = 'manager' on conflict do nothing`);
  const stockBefore = Number(sql(`select stock_quantity from products where id = '${PERFUME}'`));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const CUSTOMER = { email: "checkout-e2e@example.com", password: "Checkout2026e2e" };
  await ensureCustomer(CUSTOMER.email, CUSTOMER.password);
  await loginCustomer(p, B, CUSTOMER.email, CUSTOMER.password);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));

  // ---- Checkout (an account without name / phone yet: they are entered once here, then locked)
  sql(`update customer_accounts set full_name = null, phone = null where id = (select id from auth.users where email = '${CUSTOMER.email}')`);
  await p.goto(B + "/");
  await p.evaluate(([a, c]) => {
    localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: a, quantity: 2 }, { type: "product", productId: c, quantity: 1 }]));
    localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "delivery", deliveryZoneId: "40000000-0000-0000-0000-000000000001" }));
  }, [PERFUME, CHARGER]);
  await p.goto(B + "/checkout");
  await p.waitForSelector("text=Order summary");
  check((await p.locator("dl div:has(dt:text-is('Total')) dd").textContent()) === "6,700 ETB", "checkout summary total 6,700 ETB");

  await p.check("label:has-text('I agree') input[type=checkbox]");
  await p.fill("#fullName", "Abebe Kebede");
  await p.fill("#phone", "12345");
  await p.fill("#addressLine", "Bole, House 12");
  await p.click("button[type=submit]");
  await p.waitForSelector("#phone-error");
  check((await p.locator("#phone-error").textContent()).includes("Ethiopian"), "invalid phone rejected server-side with field error");

  await p.fill("#phone", "0911 22 33 44");
  await p.click("button[type=submit]");
  await p.waitForURL(/\/order-success\//, { timeout: 20000 });
  const orderId = p.url().split("/order-success/")[1].split("?")[0];
  check(sql(`select full_name || '|' || phone from customer_accounts where id = (select id from auth.users where email = '${CUSTOMER.email}')`) === "Abebe Kebede|+251911223344",
    "name and phone entered once are saved to the account");
  check(!p.url().includes("t="), "order page URL contains no access token");
  check((await p.locator("h1").textContent()).startsWith("Order ET-"), "redirected to order confirmation");
  const orderNumber = (await p.locator("h1").textContent()).replace("Order ", "");
  check((await p.locator("text=1000000000000").count()) > 0, "bank account number shown");
  check((await p.locator("text=6,700 ETB").count()) > 0, "exact amount shown");
  check(!(await p.locator("main").innerText()).includes("Tracking code"), "no tracking code: tracking is by sign-in now");
  check((await p.evaluate(() => localStorage.getItem("cart:v1"))) === "[]", "basket cleared after order");
  check(Number(sql(`select stock_quantity from products where id = '${PERFUME}'`)) === stockBefore - 2, "stock reserved in database");
  const dbTotal = sql(`select total_etb from orders where id = '${orderId}'`);
  check(dbTotal === "6700.00", `database total ${dbTotal}`);

  // Copy button
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.locator("button[aria-label='Copy Account number']").click();
  check((await p.evaluate(() => navigator.clipboard.readText())) === "1000000000000", "copy account number");

  // ---- Receipt: forged file rejected and deleted
  await p.fill("#reference", "FT2611ABC123");
  await p.setInputFiles("#receipt", fakePng);
  await p.click("button:has-text('Submit payment proof')");
  await p.waitForSelector("form [role=alert]");
  check((await p.locator("form [role=alert]").textContent()).includes("JPG, PNG or PDF"), "HTML disguised as PNG rejected by content check");
  check(sql(`select count(*) from storage.objects where bucket_id = 'payment-receipts' and name like 'orders/${orderId}/%'`) === "0", "rejected upload deleted from storage");
  check(sql(`select status from orders where id = '${orderId}'`) === "awaiting_payment", "order still awaiting payment");

  // ---- Receipt: real file accepted
  await p.setInputFiles("#receipt", realPng);
  await p.click("button:has-text('Submit payment proof')");
  await p.waitForSelector("text=We are verifying your payment", { timeout: 20000 });
  check(sql(`select status || '/' || payment_status from orders where id = '${orderId}'`) === "pending_verification/pending_verification", "order → pending verification");
  check(sql(`select count(*) from storage.objects where bucket_id = 'payment-receipts' and name like 'orders/${orderId}/%'`) === "1", "receipt stored in private bucket");
  check(sql(`select receipt_mime || ' ' || transaction_reference from payment_submissions where order_id = '${orderId}'`) === "image/png FT2611ABC123", "submission metadata recorded");
  check(sql(`select count(*) from notifications_outbox where event_type = 'new_order' and payload->>'order_id' = '${orderId}'`) === "0", "no Telegram alert while the payment waits for approval (default off)");
  check((await p.locator("#receipt").count()) === 0, "payment form hidden while pending");
  const objectPath = sql(`select receipt_path from payment_submissions where order_id = '${orderId}'`);
  const publicTry = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/payment-receipts/${objectPath}`);
  check(publicTry.status >= 400, `receipt not reachable via public URL (${publicTry.status})`);

  // ---- Admin rejects → the order is cancelled automatically
  sql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${MANAGER}","role":"authenticated","aal":"aal2"}', true);
       select admin_review_payment((select id from payment_submissions where order_id = '${orderId}' and status = 'pending'), 'rejected', 'Amount not received'); commit;`);
  await p.reload();
  await p.waitForSelector("text=We could not verify your payment");
  check((await p.locator("text=Amount not received").count()) > 0, "rejection reason shown to customer");
  check(sql(`select status || '/' || payment_status from orders where id = '${orderId}'`) === "cancelled/rejected" && await p.locator("#receipt").count() === 0,
    "rejected payment cancels the order (no new receipt can be sent)");
  check(Number(sql(`select stock_quantity from products where id = '${PERFUME}'`)) === stockBefore, "its stock is released");

  // ---- Private link on another device
  const other = await b.newContext();
  const o = await other.newPage();
  await o.goto(`${B}/order-success/${orderId}`);
  check(new URL(o.url()).pathname === "/account/login" && (await o.locator(`text=${orderNumber}`).count()) === 0,
    "other device without token: asked to sign in, order not shown");
  await o.goto(`${B}/order-success/${orderId}?t=${"A".repeat(43)}`);
  check(new URL(o.url()).pathname === "/account/login" && (await o.locator(`text=${orderNumber}`).count()) === 0,
    "wrong token: asked to sign in, order not shown");
  check((await fetch(`${B}/order-success/${orderId}?t=${"A".repeat(43)}`, { redirect: "manual" })).headers.get("referrer-policy") === "no-referrer",
    "order page sends Referrer-Policy: no-referrer");

  // ---- Tracking: signed-in customers, their own orders only
  await o.goto(B + "/track-order");
  check(new URL(o.url()).pathname === "/account/login" && o.url().includes("next=%2Ftrack-order"), "track order asks a signed-out visitor to sign in");
  await p.goto(B + "/track-order");
  await p.fill("#orderNumber", orderNumber.toLowerCase());
  await p.click("button[type=submit]");
  await p.waitForSelector(`h2:text("${orderNumber}")`);
  const html = await p.content();
  check(html.includes("Cancelled"), "tracking shows status of the customer's own order");
  // (The side menu carries the signed-in customer's own name; the tracking result itself shows no personal data.)
  const result = await p.locator("main").innerText();
  check(!result.includes("Abebe") && !result.includes("911223344") && !result.includes("Bole"), "tracking result shows no name/phone/address");
  check(await p.locator("#trackingCode").count() === 0, "no tracking code asked");
  const otherOrder = sql("select order_number from orders where user_id is distinct from (select id from auth.users where email = '" + CUSTOMER.email + "') order by created_at desc limit 1");
  if (otherOrder) {
    await p.fill("#orderNumber", otherOrder);
    await p.click("button[type=submit]");
    await p.waitForSelector("text=None of your orders");
    check(true, `another customer's order (${otherOrder}) cannot be tracked`);
  }
  for (let i = 0; i < 10; i++) {
    await p.click("button[type=submit]");
    await p.waitForTimeout(300);
  }
  check((await p.locator("text=Too many attempts").count()) === 1, "tracking lookups are rate-limited");
  sql("delete from rate_limits where key like 'track:%'");

  // ---- Expiry
  await p.goto(B + "/");
  await p.evaluate((c) => localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: c, quantity: 1 }])), CHARGER);
  await p.goto(B + "/checkout");
  await p.waitForSelector("text=Order summary");
  await p.check("label:has-text('I agree') input[type=checkbox]");
  check(await p.locator("#fullName[readonly]").count() === 1 && await p.locator("#phone[readonly]").count() === 1
    && await p.inputValue("#fullName") === "Abebe Kebede", "next order: name and phone from the account, not editable");
  await p.evaluate(() => { document.querySelector("#fullName").removeAttribute("readonly"); });
  await p.fill("#fullName", "Someone Else");
  await p.check("input[type=radio] >> nth=1");
  await p.click("button[type=submit]");
  await p.waitForURL(/\/order-success\//);
  const order2 = p.url().split("/order-success/")[1];
  check(sql(`select customer_name from orders where id = '${order2}'`) === "Abebe Kebede", "a name changed in the browser is ignored: the account's name is used");
  check((await p.locator("text=Free").count()) > 0, "pickup order has free delivery");
  sql(`update orders set payment_due_at = now() - interval '1 minute' where id = '${order2}'`);
  const noAuth = await fetch(`${B}/api/cron/expire-orders`);
  check(noAuth.status === 401, "cron endpoint rejects unauthenticated calls");
  const withAuth = await fetch(`${B}/api/cron/expire-orders`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const body = await withAuth.json();
  check(withAuth.status === 200 && body.expired >= 1, `cron expires overdue orders (${JSON.stringify(body)})`);
  await p.reload();
  check((await p.locator("text=This order has expired").count()) === 1, "customer sees expired order");

  // ---- Mobile layout of checkout + order page
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.context().addCookies(await ctx.cookies()); // same signed-in customer + order cookies
  await m.goto(`${B}/order-success/${order2}`);
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "order page has no horizontal overflow on mobile");
  await m.evaluate((c) => localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: c, quantity: 1 }])), CHARGER);
  await m.goto(B + "/checkout");
  await m.waitForSelector("text=Order summary");
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "checkout has no horizontal overflow on mobile");
  check((await m.locator("a[href='/terms']:has-text('terms and conditions')").count()) === 1, "terms link rendered in checkout");

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  console.log(results.join("\n"));
  await b.close();
  fs.rmSync(tmp, { recursive: true });
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
