/**
 * Home sign-in, sold-out items leave the basket, ticket rating pop-up + 24 h visibility, Excel exports page, clear tickets after export.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/exports-tickets.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const ExcelJS = require("exceljs");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
const SOLD = "20000000-0000-0000-0000-000000000006"; // sample product set to 0 below
const OK = "20000000-0000-0000-0000-000000000007";

(async () => {
  sql("delete from rate_limits where true");
  const stockBefore = sql(`select stock_quantity from products where id = '${SOLD}'`);
  const email = `exports-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "ExportsE2E2026x");
  const b = await chromium.launch();
  try {
    // ---- home: Sign in and Create account when signed out
    const anon = await (await b.newContext()).newPage();
    await anon.goto(`${B}/`);
    check(await anon.locator("[data-testid=home-signin]").count() === 1 && await anon.locator('main a[href="/account/signup"]').count() >= 1, "home shows Sign in and Create account");

    // ---- basket: sold-out items are removed automatically
    sql(`update products set stock_quantity = 0, track_inventory = true where id = '${SOLD}'`);
    await anon.evaluate(([a, c]) => localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: a, quantity: 1 }, { type: "product", productId: c, quantity: 1 }])), [SOLD, OK]);
    await anon.goto(`${B}/cart`);
    await anon.waitForSelector("[data-testid=soldout-removed]");
    const cartNow = await anon.evaluate(() => JSON.parse(localStorage.getItem("cart:v1") || "[]").map((i) => i.productId));
    check(cartNow.length === 1 && cartNow[0] === OK, "sold-out product removed from the basket, the rest kept");
    sql(`update products set stock_quantity = ${stockBefore} where id = '${SOLD}'`);

    // ---- customer opens a ticket; staff close it; rating pop-up
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "ExportsE2E2026x", "/support");
    await c.waitForURL(/\/support$/);
    await c.selectOption("#topic", "app");
    await c.fill("#details", "The product photos do not load on my phone.");
    await c.click("[data-testid=support-form] button[type=submit]");
    await c.waitForSelector("text=/ticket T-\\d+ was created/");
    const tk = sql(`select id from support_tickets where user_id = '${uid}' order by created_at desc limit 1`);
    const number = sql(`select ticket_number from support_tickets where id = '${tk}'`);

    const o = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/support/${tk}`);
    await o.fill("textarea[name=message]", "Fixed — please try again.");
    await o.selectOption("select[name=status]", "closed");
    await o.click("form button:has-text('Save')");
    await o.waitForSelector("[data-sonner-toast]");

    await c.goto(`${B}/`);
    await c.waitForSelector("[data-testid=rate-prompt]", { timeout: 10000 });
    check((await c.locator("[data-testid=rate-prompt]").innerText()).includes(number), "rating pop-up appears after the ticket is closed");
    await c.click("[data-testid=rate-close]");
    check(await c.locator("[data-testid=rate-prompt]").count() === 0, "customer can close the pop-up");
    await c.reload();
    await c.waitForTimeout(1500);
    check(await c.locator("[data-testid=rate-prompt]").count() === 0, "closed pop-up does not come back");
    await c.goto(`${B}/support/${tk}`);
    await c.click("[data-testid=star-4]");
    await c.fill("[data-testid=rate-form] textarea", "Thanks!");
    await c.click("[data-testid=rate-form] button[type=submit]");
    await c.locator("[data-testid=my-rating]").or(c.getByText("Thank you for your rating")).first().waitFor();
    check(sql(`select rating || '|' || rating_comment from support_tickets where id = '${tk}'`) === "4|Thanks!", "rated 4 stars with a comment");

    // ---- 24 h after closing it disappears from the customer app
    sql(`update support_tickets set closed_at = now() - interval '25 hours' where id = '${tk}'`);
    await c.goto(`${B}/support`);
    check(!(await c.locator("main").innerText()).includes(number), "closed ticket gone from My tickets after 24 h");
    check((await c.goto(`${B}/support/${tk}`)).status() === 404, "and its page is gone");

    // ---- admin: rating shown, Excel export, clear after export
    await o.goto(`${B}/admin/support?tab=all`);
    check((await o.locator("[data-testid=rating-avg]").count()) === 1, "average rating shown");
    const [dl] = await Promise.all([o.waitForEvent("download"), o.click("[data-testid=tickets-export]")]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    let row = null;
    wb.worksheets[0].eachRow((r) => { if (String(r.getCell(1).value) === number) row = r; });
    check(!!row && Number(row.getCell(14).value) === 4 && String(row.getCell(15).value) === "Thanks!", "support tickets Excel includes the rating");
    await o.goto(`${B}/admin/exports`);
    for (const name of ["Customers", "Products & stock"]) {
      const [x] = await Promise.all([o.waitForEvent("download"), o.click(`[data-testid="export-${name}"]`)]);
      const w = new ExcelJS.Workbook();
      await w.xlsx.readFile(await x.path());
      check(w.worksheets[0].rowCount > 1, `${name} export downloaded with data`);
    }
    check(sql("select count(*) from audit_logs where action in ('export_customers', 'export_products', 'export_support') and created_at > now() - interval '5 minutes'") >= "3", "exports recorded");
    await o.click("summary:has-text('Clear closed tickets')");
    const clear = o.locator("form:has(button:has-text('Clear closed tickets'))");
    await clear.locator("input[name=from]").fill(today);
    await clear.locator("input[name=to]").fill(today);
    await clear.locator("button:has-text('Clear closed tickets')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Cleared')");
    check(sql(`select count(*) from support_tickets where id = '${tk}'`) === "0", "closed tickets cleared after the export");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    sql(`update products set stock_quantity = ${stockBefore} where id = '${SOLD}'`);
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
