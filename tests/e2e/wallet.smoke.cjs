/**
 * Wallet (shop credit): customer top-up with receipt → manager verifies →
 * pay a whole order with the balance → cancel refunds; limits and permissions.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/wallet.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const zlib = require("zlib");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer, fillIfEditable } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const CHARGER = "20000000-0000-0000-0000-000000000007";
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });

function png(seed) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(8, 0); ih.writeUInt32BE(8, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc(8 * 25, seed % 255);
  for (let y = 0; y < 8; y++) raw[y * 25] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function requestTopup(page, amount, seed) {
  await page.goto(`${B}/account/wallet`);
  await page.fill("#topup-amount", String(amount));
  await page.fill("#topup-reference", `FT${RUN}${seed}`.slice(0, 20));
  await page.setInputFiles("#topup-receipt", { name: "receipt.png", mimeType: "image/png", buffer: png(seed) });
  await page.click("button:has-text('Send top-up request')");
}

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const email = `wallet-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "WalletE2E2026x");
  const mEmail = `wallet-mgr-${RUN}@example.com`;
  const mid = await ensureCustomer(mEmail, "WalletMgr2026x");
  sql(`insert into profiles (id, full_name, role_id) select '${mid}', 'Wallet Manager', id from admin_roles where key = 'manager'`);
  const sEmail = `wallet-staff-${RUN}@example.com`;
  const sid = await ensureCustomer(sEmail, "WalletStaff2026x");
  sql(`insert into profiles (id, full_name, role_id) select '${sid}', 'Wallet Staff', id from admin_roles where key = 'staff'`);
  const b = await chromium.launch();
  try {
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "WalletE2E2026x");
    await c.goto(`${B}/account`);
    check((await c.locator("main").innerText()).includes("My balance"), "My account shows the balance");

    // ---- top-up requests
    await requestTopup(c, 3000, 1);
    await c.waitForSelector("[role=status]:has-text(\"was sent\")");
    check(sql(`select count(*) || ':' || sum(amount_etb) from wallet_topups where user_id = '${uid}' and status = 'pending'`) === "1:3000.00", "top-up request recorded (pending)");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "0.00", "nothing credited before verification");
    await requestTopup(c, 7500, 2);
    await c.waitForSelector("form [role=alert]");
    check((await c.locator("form [role=alert]").innerText()).includes("10,000"), "requests above the 10,000 ETB limit are refused");
    await c.goto(`${B}/account/wallet`);
    await c.fill("#topup-amount", "100");
    await c.setInputFiles("#topup-receipt", { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image at all, really not") });
    await c.click("button:has-text('Send top-up request')");
    await c.waitForSelector("form [role=alert]");
    check(sql(`select count(*) from wallet_topups where user_id = '${uid}'`) === "1", "fake receipt files are refused");

    // ---- staff cannot; manager verifies
    const s = await (await b.newContext()).newPage();
    await adminLogin(s, B, sEmail, "WalletStaff2026x");
    check((await s.goto(`${B}/admin/wallet`)).status() === 404 && await s.locator("aside a[href='/admin/wallet']").count() === 0, "staff cannot open the wallet admin");
    const m = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    m.on("dialog", (d) => d.accept());
    await adminLogin(m, B, mEmail, "WalletMgr2026x");
    check((await m.locator("aside a[href='/admin/wallet'] span[aria-label]").textContent()) >= "1", "red badge for top-ups to verify");
    await m.goto(`${B}/admin/wallet`);
    await m.click(`a[href='/admin/wallet/${sql(`select id from wallet_topups where user_id = '${uid}' and status = 'pending' order by created_at desc limit 1`)}']`);
    await m.waitForURL(/\/admin\/wallet\/[0-9a-f-]{36}$/);
    check(await m.locator("main").getByText(`${sql(`select member_id from customer_accounts where id = '${uid}'`)}`).count() >= 1, "top-up page shows the customer's User ID");
    const card = m.locator("main");
    check(await card.locator("img, a").count() >= 1, "receipt preview shown to the manager");
    await card.locator("button:has-text('Verify and add to balance')").click();
    await m.waitForSelector("[data-sonner-toast]:has-text('Top-up verified')");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "3000.00", "manager verified: balance 3,000");
    check(await (await m.goto(`${B}/admin/customers/${uid}?tab=wallet`)) && await m.locator("button:has-text('Correct balance')").count() === 0, "managers cannot correct balances manually");

    // ---- pay a whole order with the balance
    await c.evaluate((id) => {
      localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: id, quantity: 2 }]));
      localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "pickup", deliveryZoneId: null }));
    }, CHARGER);
    await c.goto(`${B}/checkout`);
    await c.waitForSelector("text=Pay with my balance");
    await fillIfEditable(c, "#fullName", "Wallet Customer");
    await fillIfEditable(c, "#phone", "0911 22 77 88");
    await c.check("text=Pay with my balance");
    await c.check("label:has-text('I agree') input[type=checkbox]");
    await c.click("button:has-text('Place order')");
    await c.waitForURL(/order-success/);
    const orderId = c.url().split("/order-success/")[1].split("?")[0];
    check((await c.locator("main").innerText()).includes("Paid with your balance"), "order page: paid with balance, confirmed");
    check(sql(`select status || ':' || payment_status || ':' || payment_method from orders where id = '${orderId}'`) === "confirmed:verified:wallet", "order confirmed immediately");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "1300.00", "balance debited 1,700");
    // not enough for a big order
    await c.evaluate((id) => localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: id, quantity: 3 }])), CHARGER);
    await c.goto(`${B}/checkout`);
    await c.waitForSelector("text=does not cover this order");
    check(await c.locator("input[type=radio][name=pay]:disabled").count() === 1, "balance option disabled when it does not cover the order");

    // ---- cancel → refund to balance; history
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/orders/${orderId}`);
    await o.fill("textarea[aria-label='Cancellation reason']", "Customer asked to cancel");
    await o.click("button:has-text('Cancel order')");
    await o.waitForSelector("[data-sonner-toast]");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "3000.00", "cancelled balance-paid order refunded to the balance");
    await c.goto(`${B}/account/wallet`);
    const hist = await c.locator("main").innerText();
    check(hist.includes("Top-up") && hist.includes("Order payment") && hist.includes("Refund"), "customer history: top-up, payment, refund");

    // ---- super admin correction + reject flow
    await o.goto(`${B}/admin/customers/${uid}?tab=wallet`);
    await o.fill("#adj-amount", "-1000");
    await o.fill("#adj-reason", "Test correction");
    await o.click("button:has-text('Correct balance')");
    await toast(o, "Balance corrected");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "2000.00", "super admin corrected the balance (−1,000)");
    await requestTopup(c, 500, 3);
    await c.waitForSelector("[role=status]:has-text(\"was sent\")");
    await m.goto(`${B}/admin/wallet`);
    await m.click(`a[href='/admin/wallet/${sql(`select id from wallet_topups where user_id = '${uid}' and status = 'pending' order by created_at desc limit 1`)}']`);
    const card2 = m.locator("main");
    await card2.locator("textarea").fill("Not in our bank statement");
    await card2.locator("button:has-text('Reject')").click();
    await m.waitForSelector("[data-sonner-toast]:has-text('Top-up rejected')");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "2000.00", "rejected top-up adds nothing");
    await c.goto(`${B}/account/wallet`);
    check(!(await c.locator("main").innerText()).includes("Not in our bank statement")
      && sql(`select count(*) from notifications_outbox where event_type = 'customer_topup_rejected' and recipient_user_id = '${uid}' and payload->>'note' = 'Not in our bank statement'`) >= "1",
      "a rejected top-up is not listed (only accepted ones count); the customer is emailed the reason");
    check(sql(`select count(*) from notifications_outbox where channel = 'email' and recipient_user_id = '${uid}' and event_type like 'customer_topup_%'`) === "2", "customer emailed about verification and rejection");
    check(sql(`select count(*) from audit_logs where entity_id = '${uid}' and action in ('topup_verified','topup_rejected','wallet_adjusted')`) === "3", "all wallet decisions in the activity log");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
    if (process.env.DEBUG_SHOTS) for (const [i, pg] of b.contexts().flatMap((x) => x.pages()).entries()) await pg.screenshot({ path: `${process.env.DEBUG_SHOTS}/wallet-fail-${i}.png` }).catch(() => {});
  } finally {
    await b.close();
    sql(`update profiles set is_active = false where id in ('${mid}', '${sid}')`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
