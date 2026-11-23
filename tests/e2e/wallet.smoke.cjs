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
  await page.goto(`${B}/account/wallet/top-up`);
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

    // ---- top-up: the Top up button opens a page with our bank details and the steps
    await c.goto(`${B}/account/wallet`);
    await c.click("[data-testid=topup-button]");
    await c.waitForURL(/\/account\/wallet\/top-up$/);
    const steps = await c.locator("[data-testid=topup-steps]").innerText();
    check(await c.locator("[data-testid=topup-banks]").count() === 1 && steps.includes("Top Up") && /exact/i.test(steps),
      "top-up page: bank details and steps (reason \"Top Up\", exact amount)");
    await requestTopup(c, 3000, 1);
    await c.waitForSelector("[role=status]:has-text(\"was sent\")");
    check(sql(`select count(*) || ':' || sum(amount_etb) from wallet_topups where user_id = '${uid}' and status = 'pending'`) === "1:3000.00", "top-up request recorded (pending)");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "0.00", "nothing credited before verification");
    await requestTopup(c, 7500, 2);
    await c.waitForSelector("form [role=alert]");
    check((await c.locator("form [role=alert]").innerText()).includes("10,000"), "requests above the 10,000 ETB limit are refused");
    await c.goto(`${B}/account/wallet/top-up`);
    await c.fill("#topup-amount", "100");
    await c.setInputFiles("#topup-receipt", { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image at all, really not") });
    await c.click("button:has-text('Send top-up request')");
    await c.waitForSelector("form [role=alert]");
    check(sql(`select count(*) from wallet_topups where user_id = '${uid}'`) === "1", "fake receipt files are refused");

    // ---- virus scan (Cloudmersive; a local fake in tests): infected → refused, deleted, security alert
    const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const scanStats = async () => (await fetch("http://127.0.0.1:4610/stats")).json();
    const before = await scanStats();
    check(before.scans > 0 && before.lastHeaders.allowexecutables === "false" && before.lastHeaders.allowpasswordprotectedfiles === "false"
      && /\.png/.test(before.lastHeaders.restrictfiletypes ?? ""), "the accepted receipt was virus-scanned (strict settings, only the expected file type)");
    const filesBefore = sql(`select count(*) from storage.objects where bucket_id = 'payment-receipts' and name like 'topups/${uid}/%'`);
    await c.goto(`${B}/account/wallet/top-up`);
    await c.fill("#topup-amount", "100");
    await c.setInputFiles("#topup-receipt", { name: "receipt.png", mimeType: "image/png", buffer: Buffer.concat([png(7), Buffer.from(EICAR)]) });
    await c.click("button:has-text('Send top-up request')");
    await c.waitForSelector("form [role=alert]");
    check((await c.locator("form [role=alert]").innerText()).includes("failed our security check"), "infected file: the customer is told it failed the security check");
    check(sql(`select count(*) from wallet_topups where user_id = '${uid}'`) === "1", "infected file: no top-up created");
    check(sql(`select count(*) from storage.objects where bucket_id = 'payment-receipts' and name like 'topups/${uid}/%'`) === filesBefore, "infected file: deleted from storage");
    check(sql(`select count(*) from security_events where kind = 'upload_blocked' and user_id = '${uid}' and metadata->>'found' like '%EICAR%' and metadata->>'where' = 'topup_receipt'`) === "1",
      "infected file: security event with what was found");
    check(sql(`select count(*) from notifications_outbox where event_type = 'security_event' and payload->>'kind' = 'upload_blocked'
      and payload->>'user_id' = (select member_id from customer_accounts where id = '${uid}')`) >= "1", "infected file: security Telegram alert with the User ID");
    // scanner unavailable → refused (nothing unscanned is accepted)
    await c.goto(`${B}/account/wallet/top-up`);
    await c.fill("#topup-amount", "100");
    await c.setInputFiles("#topup-receipt", { name: "receipt.png", mimeType: "image/png", buffer: Buffer.concat([png(8), Buffer.from("SCANNER-DOWN-TEST")]) });
    await c.click("button:has-text('Send top-up request')");
    await c.waitForSelector("form [role=alert]");
    check((await c.locator("form [role=alert]").innerText()).includes("security check for files is unavailable"), "scanner down: upload refused, the customer is asked to try again later");
    check(sql(`select count(*) from wallet_topups where user_id = '${uid}'`) === "1" && sql(`select count(*) from security_events where kind = 'scan_unavailable' and user_id = '${uid}'`) === "1",
      "scanner down: nothing created; recorded for staff");
    check(sql(`select string_agg(result, ',' order by id) from upload_scans where user_id = '${uid}' and source = 'topup_receipt'`) === "clean,blocked,unavailable",
      "every scan is kept in the scan history (clean, blocked, scanner unavailable)");

    // ---- file size vs the scanner plan (3.5 MB): big photos are made smaller in the browser; big PDFs get a clear message
    function noisePng(side) {
      const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
      const crc = (bb) => { let c = 0xffffffff; for (const x of bb) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cc]); };
      const ih = Buffer.alloc(13); ih.writeUInt32BE(side, 0); ih.writeUInt32BE(side, 4); ih[8] = 8; ih[9] = 2;
      const raw = require("crypto").randomBytes(side * (side * 3 + 1));
      for (let y = 0; y < side; y++) raw[y * (side * 3 + 1)] = 0;
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
    }
    const bigPhoto = noisePng(1700);
    check(bigPhoto.length > 8 * 1024 * 1024, `test photo is big (${(bigPhoto.length / 1048576).toFixed(1)} MB)`);
    const topupsBefore = Number(sql(`select count(*) from wallet_topups where user_id = '${uid}'`));
    await c.goto(`${B}/account/wallet/top-up`);
    check((await c.locator("main").innerText()).includes("Largest file: 3.5 MB"), "top-up page tells the largest file size (3.5 MB)");
    await c.fill("#topup-amount", "100");
    await c.setInputFiles("#topup-receipt", { name: "camera-photo.png", mimeType: "image/png", buffer: bigPhoto });
    await c.click("button:has-text('Send top-up request')");
    await c.waitForSelector("[role=status]:has-text(\"was sent\")", { timeout: 60000 });
    const stored = sql(`select receipt_mime || ':' || (select (metadata->>'size')::bigint from storage.objects o where o.bucket_id = 'payment-receipts' and o.name = t.receipt_path)
      from wallet_topups t where user_id = '${uid}' order by created_at desc limit 1`);
    check(Number(sql(`select count(*) from wallet_topups where user_id = '${uid}'`)) === topupsBefore + 1 && stored.startsWith("image/jpeg:")
      && Number(stored.split(":")[1]) < 3.5 * 1024 * 1024, `a ${(bigPhoto.length / 1048576).toFixed(0)} MB photo is made smaller in the browser and accepted (${(Number(stored.split(":")[1]) / 1048576).toFixed(2)} MB JPG)`);
    sql(`delete from wallet_topups where user_id = '${uid}' and status = 'pending' and amount_etb = 100`); // keep the rest of the test unchanged
    const bigPdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4 * 1024 * 1024, 0x20), Buffer.from("\n%%EOF")]);
    const scansBefore = sql(`select count(*) from upload_scans where user_id = '${uid}'`);
    await c.goto(`${B}/account/wallet/top-up`);
    await c.fill("#topup-amount", "100");
    await c.setInputFiles("#topup-receipt", { name: "statement.pdf", mimeType: "application/pdf", buffer: bigPdf });
    await c.click("button:has-text('Send top-up request')");
    await c.waitForSelector("form [role=alert]");
    check((await c.locator("form [role=alert]").innerText()).includes("larger than 3.5 MB"), "a 4 MB PDF: clear message with the 3.5 MB limit (not 'scanner unavailable')");
    check(sql(`select count(*) from upload_scans where user_id = '${uid}'`) === scansBefore
      && sql(`select count(*) from security_events where kind = 'scan_unavailable' and user_id = '${uid}'`) === "1", "nothing sent to the scanner, no false outage alert");

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
    check((await m.locator("[data-testid=scan-status]").innerText()).includes("Virus scan: clean"), "top-up page: the receipt's virus scan shown (clean)");
    await card.locator("button:has-text('Verify and add to balance')").click();
    await m.waitForSelector("[data-sonner-toast]:has-text('Top-up verified')");
    check(sql(`select count(*) from notifications_outbox where event_type = 'topup_verified' and payload->>'user_id' = (select member_id from customer_accounts where id = '${uid}')`) >= "1",
      "approved top-up announced in the orders & payments Telegram group");
    check(sql(`select count(*) from notifications_outbox where event_type = 'wallet_topup' and created_at > now() - interval '10 minutes'`) >= "1",
      "top-up waiting for approval is alerted as soon as the receipt is attached (always on)");
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
    await c.goto(`${B}/account/orders`);
    const trackLink = c.locator(`[data-testid=order-row]:has-text("${sql(`select order_number from orders where id = '${orderId}'`)}") [data-testid=track-button]`);
    check(await trackLink.count() === 1 && await trackLink.getAttribute("href") === `/order-success/${orderId}`, "My orders: the paid order has a Track button to its status page");
    await trackLink.click();
    await c.waitForURL(new RegExp(`/order-success/${orderId}`));
    check((await c.locator("main").innerText()).includes("Paid with your balance"), "Track opens the order's status page");
    check(sql(`select wallet_balance_etb from customer_accounts where id = '${uid}'`) === "1300.00", "balance debited 1,700");
    // not enough for a big order
    await c.evaluate((id) => localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: id, quantity: 3 }])), CHARGER);
    await c.goto(`${B}/checkout`);
    await c.waitForSelector("text=does not cover this order");
    check(await c.locator("input[type=radio][name=pay]:disabled").count() === 1, "balance option disabled when it does not cover the order");
    check(await c.locator("[data-testid=checkout-topup]").count() === 1 && await c.locator("text=Bank transfer").count() >= 1,
      "checkout: bank transfer still possible, with a Top up link");

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

    // ---- wallet search by User ID; Excel only for the Super Admin
    const mem = sql(`select member_id from customer_accounts where id = '${uid}'`);
    await m.goto(`${B}/admin/wallet?tab=balances&q=${mem}`);
    check((await m.locator("main table").innerText()).includes(mem) && await m.locator("main table tbody tr").count() === 1, "wallet balances searchable by User ID");
    await m.goto(`${B}/admin/wallet?tab=verified&q=${mem}`);
    check(await m.locator("main table tbody tr").count() >= 1, "verified top-ups searchable by User ID");
    check(await m.locator("[data-testid=wallet-export]").count() === 0, "manager sees no Excel button");
    check((await m.request.get(`${B}/admin/exports/download?kind=wallet`)).status() === 404, "manager cannot download the wallet Excel");
    await o.goto(`${B}/admin/wallet?tab=balances`);
    check(await o.locator("[data-testid=wallet-export]").count() === 1, "super admin sees the wallet Excel button");

    // ---- Security → File scans: the history, searchable by User ID
    await o.goto(`${B}/admin/security?tab=scans&q=${mem}`);
    const scanRows = await o.locator("[data-testid=scan-row]").allInnerTexts();
    check(scanRows.length === 4 && scanRows.some((t) => t.includes("blocked") && t.includes("EICAR")) && scanRows.some((t) => t.includes("clean")),
      "Security → File scans lists the customer's scans with results and findings");

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
