/**
 * Phase 7 browser test: promotions & banners admin, promo code at checkout,
 * analytics, orphaned-upload sweep, and Content-Security-Policy (no violations).
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/phase7.smoke.cjs
 * LOCAL Supabase + app on BASE_URL. Mutates the local database.
 */
const { chromium } = require("playwright");
const { adminLogin } = require("./_admin.cjs");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36).toUpperCase();
const CHARGER = "20000000-0000-0000-0000-000000000007";
const CODE = `E2E${RUN}`.slice(0, 20);
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });

/** A real 1600x700 PNG (solid colour) for the banner upload. */
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0)]);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = 20; row[2 + x * 3] = 82; row[3 + x * 3] = 63; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const violations = [];
async function watchCsp(context) {
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI}`));
  });
  context.on("page", (p) => p.on("console", (m) => /CSP-VIOLATION|Content Security Policy/i.test(m.text()) && violations.push(`${p.url()}: ${m.text()}`)));
}

(async () => {
  sql("delete from rate_limits");
  const bannerFile = path.join(os.tmpdir(), `banner-${RUN}.png`);
  fs.writeFileSync(bannerFile, png(1600, 700));
  const custEmail = `p7-${RUN.toLowerCase()}@example.com`;
  await ensureCustomer(custEmail, "PhaseSeven2026");
  const mEmail = `p7-mgr-${RUN.toLowerCase()}@example.com`;
  const M = await ensureCustomer(mEmail, "PhaseSevenMgr2026");
  sql(`insert into profiles (id, full_name, role_id) select '${M}', 'P7 Manager', id from admin_roles where key = 'manager'`);

  const b = await chromium.launch();
  try {
    // ------------------------------------------------------------ admin: promotion + banner
    const octx = await b.newContext();
    await watchCsp(octx);
    const op = await octx.newPage();
    await adminLogin(op, B, OWNER.email, OWNER.password);

    await op.goto(`${B}/admin/promotions?tab=new`);
    await op.fill("#pt-en-new", `Phase seven ${RUN}`);
    await op.fill("#pt-am-new", "የሙከራ ቅናሽ");
    await op.fill("#pc-new", CODE.toLowerCase());
    await op.fill("#pd-en-new", "Ten percent off everything");
    await op.fill("#pdv-new", "10");
    await op.check("main form input[name=show_on_homepage]");
    await op.click("button:has-text('Create promotion')");
    await toast(op, "Promotion created");
    check(sql(`select code || ':' || discount_value || ':' || show_on_homepage from promotions where code = '${CODE}'`) === `${CODE}:10.00:true`, "promotion saved with upper-case code");

    await op.goto(`${B}/admin/promotions?tab=new-banner`);
    await op.fill("#bt-en-new", `Banner ${RUN}`);
    await op.fill("#bt-am-new", "ማስታወቂያ");
    await op.fill("#bl-new", "/electronics");
    await op.setInputFiles("#bi-new", bannerFile);
    await op.click("button:has-text('Create banner')");
    await toast(op, "Banner created");
    const bannerPath = sql(`select image_path from homepage_banners where title_en = 'Banner ${RUN}'`);
    check(/^banners\/[0-9a-f-]{36}\.png$/.test(bannerPath), "banner image uploaded to storage");
    await op.setInputFiles("#bi-new", { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not really a png at all, just text") });
    await op.fill("#bt-en-new", "Fake");
    await op.fill("#bt-am-new", "Fake");
    await op.click("button:has-text('Create banner')");
    await toast(op, "not a valid");
    check(sql("select count(*) from homepage_banners where title_en = 'Fake'") === "0", "a fake image is rejected by content check");
    await op.fill("#bl-new", "https://evil.example");
    await op.click("button:has-text('Create banner')");
    await toast(op, "Link:");
    check(true, "external banner links are refused");

    // homepage shows both
    const hp = await octx.newPage();
    await hp.goto(B);
    check(await hp.locator(`text=Banner ${RUN}`).count() === 1, "banner shown on the homepage");
    check(await hp.locator(`text=${CODE}`).count() >= 1, "homepage offer shows the code");
    check(await hp.locator(`a[href='/electronics']:has-text('Banner ${RUN}')`).count() === 1, "banner links to the chosen page");

    // ------------------------------------------------------------ customer: checkout with code
    const cctx = await b.newContext();
    await watchCsp(cctx);
    const cp = await cctx.newPage();
    await loginCustomer(cp, B, custEmail, "PhaseSeven2026");
    await cp.goto(`${B}/shop`);
    await cp.evaluate((c) => {
      localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: c, quantity: 2 }]));
      localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "pickup", deliveryZoneId: null }));
    }, CHARGER);
    await cp.goto(`${B}/checkout`);
    await cp.waitForSelector("text=Order summary");
    await cp.fill("#promo", "NOPE123");
    await cp.click("button:has-text('Apply')");
    await cp.waitForSelector("#promo-error");
    check((await cp.locator("#promo-error").innerText()).includes("not valid"), "unknown code is refused");
    await cp.fill("#promo", CODE.toLowerCase());
    await cp.click("button:has-text('Apply')");
    await cp.waitForSelector(`text=${CODE} applied`);
    const total = await cp.locator("dl div:has(dt:text-is('Total')) dd").textContent();
    check(total === "1,530 ETB", `checkout shows the discounted total (${total})`);
    await cp.fill("#fullName", "Promo Buyer");
    await cp.fill("#phone", "0911223377");
    await cp.check("label:has-text('I agree') input[type=checkbox]");
    await cp.click("button:has-text('Place order')");
    await cp.waitForURL(/\/order-success\//, { timeout: 20000 });
    const orderId = cp.url().split("/order-success/")[1].split("?")[0];
    check(sql(`select discount_etb || '/' || total_etb from orders where id = '${orderId}'`) === "170.00/1530.00", "order stored with the database-computed discount");
    check(await cp.locator("text=Discount").count() >= 1, "order page shows the discount");
    // second use refused (once per customer)
    await cp.evaluate((c) => localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: c, quantity: 1 }])), CHARGER);
    await cp.goto(`${B}/checkout`);
    await cp.waitForSelector("text=Order summary");
    await cp.fill("#promo", CODE);
    await cp.click("button:has-text('Apply')");
    await cp.waitForSelector("#promo-error");
    check((await cp.locator("#promo-error").innerText()).includes("already used"), "a code can be used once per customer");

    // ------------------------------------------------------------ analytics
    sql(`update orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = '${orderId}'`);
    await op.goto(`${B}/admin/analytics?range=7d&tab=best`);
    const page = (await op.locator("main").innerText()).toLowerCase();
    check(page.includes("revenue (verified)") && page.includes("best sellers") && page.includes("25w usb-c"), "analytics shows revenue and best sellers");
    await op.goto(`${B}/admin/analytics?range=7d&tab=stock`);
    check((await op.locator("main").innerText()).toLowerCase().includes(CODE.toLowerCase()), "analytics lists promo code usage");
    await op.goto(`${B}/admin/analytics?range=12m`);
    check((await op.locator("h1").innerText()) === "Analytics", "12-month view loads");
    await op.goto(`${B}/admin/analytics?from=2026-01-01&to=2026-02-01&bucket=week`);
    check((await op.locator("main").innerText()).includes("2026-01-01 to 2026-02-01"), "custom date range");

    const mctx = await b.newContext();
    const mp = await mctx.newPage();
    await adminLogin(mp, B, mEmail, "PhaseSevenMgr2026");
    await mp.goto(`${B}/admin/analytics`);
    const mpage = (await mp.locator("main").innerText()).toLowerCase();
    check(mpage.includes("orders placed") && !mpage.includes("revenue (verified)"), "managers see counts without money");
    check((await mp.goto(`${B}/admin/promotions`)).status() === 200, "managers can manage promotions");

    // ------------------------------------------------------------ orphan sweep
    const orphan = `orders/${RUN}/orphan.png`;
    const up = await fetch(`${SUPA}/storage/v1/object/payment-receipts/${orphan}`, {
      method: "POST", headers: { apikey: SECRET, authorization: `Bearer ${SECRET}`, "content-type": "image/png" }, body: png(4, 4),
    });
    check(up.ok, "orphan test upload");
    sql(`update storage.objects set created_at = now() - interval '2 days' where name = '${orphan}'`);
    const cron = await (await fetch(`${B}/api/cron/printing-retention`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
    check(cron.orphans >= 1 && sql(`select count(*) from storage.objects where name = '${orphan}'`) === "0", `abandoned uploads are deleted (${JSON.stringify(cron)})`);

    // ------------------------------------------------------------ CSP across key pages
    for (const u of ["/", "/shop", "/products/sample-usb-c-fast-charger", "/cart", "/printing", "/contact", "/terms", "/account"]) await cp.goto(B + u);
    for (const u of ["/admin", "/admin/orders", "/admin/products", `/admin/customers`, "/admin/settings", "/admin/activity"]) await op.goto(B + u);
    const res = await cp.goto(B);
    check(/script-src[^;]*'nonce-/.test(res.headers()["content-security-policy"] ?? ""), "pages send a nonce-based CSP");
    check(violations.length === 0, `no CSP violations (${violations.slice(0, 3).join(" | ")})`);
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
    sql(`update promotions set is_active = false, show_on_homepage = false where code = '${CODE}'`);
    sql(`update homepage_banners set is_active = false where title_en = 'Banner ${RUN}'`);
    sql(`update profiles set is_active = false where id = '${M}'`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
