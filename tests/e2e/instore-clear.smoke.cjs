/**
 * In-store sales (recorded in the dashboard), clearing the activity log / notifications only after an
 * Excel export, and clearing the "Recently reviewed" list.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/instore-clear.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
// "Not exported yet" is tried on a random past day nobody exports; the real clearing uses yesterday–today.
const pastDay = new Date(Date.UTC(2021, 0, 1) + (parseInt(RUN.slice(-4), 36) % 700) * 86400000).toISOString().slice(0, 10);
const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date(Date.now() - 86400000));
const toast = (p, t) => p.waitForSelector(`[data-sonner-toast]:has-text("${t}")`, { timeout: 15000 });

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);

    // ---- in-store sale
    await o.goto(`${B}/admin/in-store`);
    check(await o.locator("aside a[href='/admin/in-store']").count() === 1, "In-store sales in the menu");
    const charger = "20000000-0000-0000-0000-000000000007";
    await o.selectOption("[data-testid=instore-form] select[aria-label='Product 1']", charger);
    await o.fill("[data-testid=instore-form] input[aria-label='Quantity 1']", "3");
    await o.selectOption("[data-testid=instore-form] select[name=paymentMethod]", "mobile_money");
    await o.click("button:has-text('Record sale')");
    await toast(o, "recorded");
    const sale = sql("select order_number || '|' || status || '|' || payment_status || '|' || payment_method from orders where channel = 'in_store' order by created_at desc limit 1");
    check(sale.endsWith("|completed|verified|mobile_money"), `sale saved as paid and completed (${sale})`);
    check(sql("select stock_quantity from products where sku = 'SMP-CH-001'") === "77", "stock went down by 3");
    const num = sale.split("|")[0];
    await o.goto(`${B}/admin/orders?q=${num}`);
    check((await o.locator("main").innerText()).includes("In store"), "listed under Orders, marked In store");
    await o.goto(`${B}/admin/in-store?tab=sales`);
    await o.locator(`tr:has-text("${num}") input[name=reason]`).fill("Entered twice");
    await o.locator(`tr:has-text("${num}") button:has-text('Void')`).click();
    await toast(o, "voided");
    check(sql("select stock_quantity from products where sku = 'SMP-CH-001'") === "80", "voided: stock back");

    // ---- activity log: clearing needs the export first
    await o.goto(`${B}/admin/activity`);
    await o.click("summary:has-text('Clear entries')");
    const clearForm = o.locator("form:has(button:has-text('Clear entries'))");
    await clearForm.locator("input[name=from]").fill(pastDay);
    await clearForm.locator("input[name=to]").fill(pastDay);
    await clearForm.locator("button:has-text('Clear entries')").click();
    await toast(o, "Download the Excel export");
    await clearForm.locator("input[name=from]").fill(yesterday);
    await clearForm.locator("input[name=to]").fill(today);
    check(true, "clearing without an export is refused");
    await o.click("summary:has-text('Export to Excel')");
    const exportForm = o.locator("form[action='/admin/activity/export']");
    await exportForm.locator("input[name=from]").fill(yesterday);
    await exportForm.locator("input[name=to]").fill(today);
    await Promise.all([o.waitForEvent("download"), exportForm.locator("button[type=submit]").click()]);
    await clearForm.locator("button:has-text('Clear entries')").click();
    await toast(o, "Cleared");
    check(sql(`select count(*) from audit_logs where action = 'audit_cleared' and metadata->>'from' = '${yesterday}'`) >= "1", "after the export: those days cleared, the clearing recorded");

    // ---- notifications: same
    sql(`insert into notifications_outbox (event_type, dedupe_key, payload, status, sent_at) values ('test_message', 'e2e-clear-${RUN}', '{}', 'sent', now())`);
    await o.goto(`${B}/admin/notifications`);
    await o.click("[data-testid=notif-export-clear] summary");
    const nExport = o.locator("form[action='/admin/notifications/export']");
    await nExport.locator("input[name=from]").fill(yesterday);
    await nExport.locator("input[name=to]").fill(today);
    const [dl] = await Promise.all([o.waitForEvent("download"), nExport.locator("button[type=submit]").click()]);
    check(/notifications-.*\.xlsx$/.test(dl.suggestedFilename()), "notifications exported to Excel");
    const nClear = o.locator("form:has(button:has-text('Clear these notifications'))");
    await nClear.locator("input[name=from]").fill(yesterday);
    await nClear.locator("input[name=to]").fill(today);
    await nClear.locator("button:has-text('Clear these notifications')").click();
    await toast(o, "Cleared");
    check(sql(`select count(*) from notifications_outbox where dedupe_key = 'e2e-clear-${RUN}'`) === "0", "after the export: notifications cleared");

    // ---- recently reviewed list
    sql(`insert into security_reviews (subject_type, subject) values ('email', 'reviewed-${RUN}@example.com') on conflict do nothing`);
    await o.goto(`${B}/admin/security?tab=emails`);
    const item = o.locator(`[data-testid=reviewed-list] li:has-text("reviewed-${RUN}@example.com")`);
    check(await item.count() === 1, "reviewed entry listed");
    await item.locator("button:has-text('Clear')").click();
    await toast(o, "Removed from the list");
    await o.reload();
    check(await o.locator(`[data-testid=reviewed-list] li:has-text("reviewed-${RUN}@example.com")`).count() === 0, "cleared from the Recently reviewed list");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
