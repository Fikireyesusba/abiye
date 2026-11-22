/**
 * Saved customer details (name / phone / email locked after they are set; staff change them; prefill checkout)
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
const addisDay = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date(Date.now() + offsetDays * 86400000));

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const email = `profile-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "ProfileE2E2026x");
  const b = await chromium.launch();
  try {
    // ---- personal details: name / phone locked once set; delivery details editable
    sql(`update customer_accounts set phone = null where id = '${uid}'`);
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "ProfileE2E2026x");
    await c.goto(`${B}/account`);
    check(await c.locator("[data-testid=account-menu] a").count() >= 2 && (await c.locator("main").innerText()).indexOf("balance") < (await c.locator("main").innerText()).indexOf("Personal details"),
      "My account: balance on top, then a menu");
    await c.click("[data-testid=account-menu] a[href='/account/details']");
    await c.waitForURL(/\/account\/details$/);
    check(await c.locator("text=/^Personal details$/").count() === 1 && await c.locator("#phone").count() === 0
      && await c.locator("button:has-text('Change delivery details')").count() === 1, "details shown read-only with a change button");
    check((await c.locator("main").innerText()).includes(email) && (await c.locator("main").innerText()).includes("can only be changed by us"), "email shown, and how to change details");
    await c.click("button:has-text('Change delivery details')");
    check(await c.locator("input#fullName").count() === 0, "name already set: not editable");
    await c.fill("#phone", "0911 45 67 89");  // missing phone: can be added once
    await c.selectOption("#zoneId", ZONE);
    await c.fill("#address", "Bole, near Edna Mall, house 12");
    await c.click("form button:has-text('Save')");
    await c.waitForSelector("text=Change delivery details");
    const view = await c.locator("main").innerText();
    check(view.includes("E2E Customer") && view.includes("Bole, near Edna Mall, house 12"), "saved details shown after saving");
    check(sql(`select full_name || '|' || phone || '|' || default_zone_id || '|' || default_address from customer_accounts where id = '${uid}'`)
      === `E2E Customer|+251911456789|${ZONE}|Bole, near Edna Mall, house 12`, "phone added once, delivery details saved");
    await c.reload();
    await c.click("button:has-text('Change delivery details')");
    check(await c.locator("input#phone").count() === 0 && await c.locator("input#fullName").count() === 0, "phone now locked too");
    sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);
         update customer_accounts set full_name = 'Hacker', phone = '+251922000000' where id = '${uid}'`);
    check(sql(`select full_name || '|' || phone from customer_accounts where id = '${uid}'`) === "E2E Customer|+251911456789", "database keeps name and phone even when sent directly");
    check(sql(`select count(*) from audit_logs where action = 'profile_updated' and entity_id = '${uid}' and after_data->>'address' is not null`) >= "1", "change recorded on the customer timeline");

    // ---- staff change the locked details (name, phone, email)
    const o0 = await (await b.newContext()).newPage();
    o0.on("dialog", (d) => d.accept());
    await adminLogin(o0, B, OWNER.email, OWNER.password);
    await o0.goto(`${B}/admin/customers/${uid}`);
    await o0.click("summary:has-text('Change personal details')");
    await o0.fill("input[name=fullName]", "Mekdes Alemu");
    await o0.fill("input[name=phone]", "0922 45 67 89");
    await o0.fill("input[name=email]", `new-${email}`);
    await o0.click("button:has-text('Save details')");
    await o0.waitForSelector("[data-sonner-toast]:has-text('Details saved')");
    check(sql(`select a.full_name || '|' || a.phone || '|' || u.email from customer_accounts a join auth.users u on u.id = a.id where a.id = '${uid}'`)
      === `Mekdes Alemu|+251922456789|new-${email}`, "staff changed name, phone and sign-in email");
    check(sql(`select count(*) from audit_logs where action = 'profile_updated' and entity_id = '${uid}' and before_data->>'email' = '${email}'`) === "1", "email change recorded (old → new)");
    await c.goto(`${B}/account`);
    if (c.url().includes("/login")) await loginCustomer(c, B, `new-${email}`, "ProfileE2E2026x");
    await o0.close();
    await c.goto(`${B}/account`);
    sql(`update auth.users set email = '${email}' where id = '${uid}'`);
    sql(`update customer_accounts set full_name = 'Mekdes Alemu' where id = '${uid}'`);

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

    // ---- the customer cancels before the payment is approved
    const cancelId = c.url().split("/order-success/")[1].split("?")[0];
    const stockBefore = Number(sql("select stock_quantity from products where sku = 'SMP-CH-001'"));
    await c.click("button:has-text('Cancel order')");
    await c.fill("textarea", "Ordered by mistake");
    await c.click("button:has-text('Yes, cancel the order')");
    await c.waitForSelector("text=This order was cancelled");
    check(sql(`select status from orders where id = '${cancelId}'`) === "cancelled", "customer cancelled their unpaid order");
    check(Number(sql("select stock_quantity from products where sku = 'SMP-CH-001'")) === stockBefore + 1, "its stock was released");
    check(await c.locator("button:has-text('Cancel order')").count() === 0, "no cancel button once cancelled");

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
    const expected = Number(sql(`select count(*) from audit_logs where created_at >= (timestamp '${addisDay(0)} 00:00' at time zone 'Europe/Warsaw')`));
    check(Math.abs(ws.rowCount - 1 - expected) <= 1, `today's entries exported (${ws.rowCount - 1} / ~${expected})`);
    let found = false;
    ws.eachRow((r) => { if (String(r.getCell(5).value).includes("Profile updated") && String(r.getCell(7).value).includes(email)) found = true; });
    check(found, "the customer's change is in the Excel file with who/what/item");
    check(sql("select count(*) from audit_logs where action = 'export_activity' and created_at > now() - interval '2 minutes'") >= "1", "export recorded");

    // ---- clearing old entries
    sql(`alter table audit_logs disable trigger audit_logs_immutable;
      insert into audit_logs (action, entity_type, entity_id, created_at) values ('e2e_old_${RUN}', 'test', 'x', now() - interval '90 days');
      alter table audit_logs enable trigger audit_logs_immutable;`);
    const oldDay = addisDay(-90);
    await o.goto(`${B}/admin/activity`);
    await o.click("summary:has-text('Clear entries')");
    const clearForm = o.locator("form:has(button:has-text('Clear entries'))");
    await clearForm.locator("input[name=from]").fill(oldDay);
    await clearForm.locator("input[name=to]").fill(oldDay);
    await clearForm.locator("button:has-text('Clear entries')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Download the Excel export')");
    check(sql(`select count(*) from audit_logs where action = 'e2e_old_${RUN}'`) === "1", "nothing cleared before the Excel export of those dates");
    const ex = await o.request.get(`${B}/admin/activity/export?from=${oldDay}&to=${oldDay}&type=`);
    check(ex.ok() && (ex.headers()["content-type"] ?? "").includes("spreadsheetml"), "Excel export of those dates downloaded");
    await clearForm.locator("button:has-text('Clear entries')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Cleared')");
    check(sql(`select count(*) from audit_logs where action = 'e2e_old_${RUN}'`) === "0", "after the export: entries of those dates cleared");
    check(sql(`select count(*) from audit_logs where action = 'profile_updated' and entity_id = '${uid}'`) >= "1", "other days kept");
    check(sql(`select count(*) from audit_logs where action = 'audit_cleared' and created_at > '${STARTED}'`) >= "1", "the clearing is recorded");
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
