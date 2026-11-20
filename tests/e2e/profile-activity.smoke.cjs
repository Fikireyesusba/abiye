/**
 * Saved customer details (view → "Change personal details" → saved; prefill checkout)
 * and Activity log export to Excel + controlled clearing.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/profile-activity.smoke.cjs
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
const STARTED = new Date().toISOString();
const ZONE = "40000000-0000-0000-0000-000000000001";
const addisDay = (offsetDays = 0) => new Date(Date.now() + 3 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const email = `profile-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "ProfileE2E2026x");
  const b = await chromium.launch();
  try {
    // ---- personal details: read-only view, then change
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "ProfileE2E2026x");
    await c.goto(`${B}/account`);
    check(await c.locator("text=/^Personal details$/").count() === 1 && await c.locator("#phone").count() === 0
      && await c.locator("button:has-text('Change personal details')").count() === 1, "details shown read-only with a change button");
    check((await c.locator("main").innerText()).includes(email), "email shown");
    await c.click("button:has-text('Change personal details')");
    await c.fill("#fullName", "Mekdes Alemu");
    await c.fill("#phone", "0911 45 67 89");
    await c.selectOption("#zoneId", ZONE);
    await c.fill("#address", "Bole, near Edna Mall, house 12");
    await c.click("form button:has-text('Save')");
    await c.waitForSelector("text=Change personal details");
    const view = await c.locator("main").innerText();
    check(view.includes("Mekdes Alemu") && view.includes("+251 91 145 6789".replace(/ /g, " ")) === view.includes("+251 91 145 6789") && view.includes("Bole, near Edna Mall, house 12"),
      "saved details shown after saving");
    check(sql(`select full_name || '|' || phone || '|' || default_zone_id || '|' || default_address from customer_accounts where id = '${uid}'`)
      === `Mekdes Alemu|+251911456789|${ZONE}|Bole, near Edna Mall, house 12`, "details saved on the account");
    await c.reload();
    check((await c.locator("main").innerText()).includes("Bole, near Edna Mall, house 12"), "still there after reloading");
    check(sql(`select count(*) from audit_logs where action = 'profile_updated' and entity_id = '${uid}' and after_data->>'address' is not null`) === "1", "change recorded on the customer timeline");

    // ---- checkout prefilled; a new delivery address is remembered
    await c.evaluate((id) => localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: id, quantity: 1 }])), "20000000-0000-0000-0000-000000000007");
    await c.goto(`${B}/checkout`);
    await c.waitForSelector("text=Order summary");
    check(await c.inputValue("#fullName") === "Mekdes Alemu" && await c.inputValue("#addressLine") === "Bole, near Edna Mall, house 12"
      && await c.inputValue("#zone") === ZONE, "checkout prefilled with saved name, city and address");
    await c.fill("#addressLine", "Kazanchis, building 5");
    await c.check("label:has-text('I agree') input[type=checkbox]");
    await c.click("button:has-text('Place order')");
    await c.waitForURL(/order-success/);
    check(sql(`select default_address from customer_accounts where id = '${uid}'`) === "Kazanchis, building 5", "the latest delivery address is remembered");

    // ---- activity log export
    const o = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/activity`);
    await o.click("summary:has-text('Export to Excel')");
    await o.fill("input[name=from]", addisDay(0));
    await o.fill("input[name=to]", addisDay(0));
    const [dl] = await Promise.all([o.waitForEvent("download"), o.click("button:has-text('Download .xlsx')")]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    const ws = wb.getWorksheet("Activity log");
    const expected = Number(sql(`select count(*) from audit_logs where created_at >= '${addisDay(0)}T00:00:00+03:00'`));
    check(Math.abs(ws.rowCount - 1 - expected) <= 1, `today's entries exported (${ws.rowCount - 1} / ~${expected})`);
    let found = false;
    ws.eachRow((r) => { if (String(r.getCell(4).value).includes("Profile updated") && String(r.getCell(6).value).includes(email)) found = true; });
    check(found, "the customer's change is in the Excel file with who/what/item");
    check(sql("select count(*) from audit_logs where action = 'export_activity' and created_at > now() - interval '2 minutes'") >= "1", "export recorded");

    // ---- clearing old entries
    sql(`alter table audit_logs disable trigger audit_logs_immutable;
      insert into audit_logs (action, entity_type, entity_id, created_at) values ('e2e_old_${RUN}', 'test', 'x', now() - interval '90 days');
      alter table audit_logs enable trigger audit_logs_immutable;`);
    await o.goto(`${B}/admin/activity`);
    await o.click("summary:has-text('Clear old entries')");
    await o.fill("input[name=before]", addisDay(-60));
    await o.click("button:has-text('Clear entries')");
    await o.waitForTimeout(1500);
    check(await o.locator("input[name=exported]").evaluate((el) => !el.checkValidity()), "the export checkbox must be ticked");
    check(sql(`select count(*) from audit_logs where action = 'e2e_old_${RUN}'`) === "1", "nothing cleared without confirming the export");
    await o.check("input[name=exported]");
    await o.click("button:has-text('Clear entries')");
    await o.waitForSelector("[data-sonner-toast]:has-text('Cleared')");
    check(sql(`select count(*) from audit_logs where action = 'e2e_old_${RUN}'`) === "0", "entries older than the date cleared");
    check(sql(`select count(*) from audit_logs where action = 'profile_updated' and entity_id = '${uid}'`) >= "1", "recent entries kept");
    check(sql(`select count(*) from audit_logs where action = 'audit_cleared' and created_at > '${STARTED}'`) === "1", "the clearing is recorded");
    check(await o.locator("input[name=before]").getAttribute("max") === addisDay(-31), "the last 30 days cannot be chosen");
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
