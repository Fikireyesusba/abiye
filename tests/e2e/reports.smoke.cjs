/**
 * Sales reports: daily closing and monthly statement match the database, Excel export, print layout, permissions.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/reports.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const ExcelJS = require("exceljs");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date()); // Warsaw date
const asOwner = (q) => sql(`begin; select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = '${OWNER.email}'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated; ${q}; commit;`);
const etb = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ETB`;

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  // A bank-paid order verified today, so the day has data.
  const cid = await ensureCustomer(`reports-${RUN}@example.com`, "ReportsE2E2026x");
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key','${key}',
    'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','Report Buyer','phone','+251911223396'),'fulfillment',jsonb_build_object('method','pickup'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',2))))`);
  const oid = sql(`select id from orders where idempotency_key = '${key}'`);
  sql(`set role service_role; select public.submit_payment(jsonb_build_object('order_id','${oid}','access_token_hash',encode(sha256('a${key}'::bytea),'hex'),
    'transaction_reference','FTREP${RUN}','receipt',jsonb_build_object('path','orders/${oid}/r.png','mime','image/png','size',100,'sha256',encode(sha256('rep${RUN}'::bytea),'hex'))))`);
  asOwner(`select public.admin_review_payment((select id from payment_submissions where order_id = '${oid}'), 'verified')`);
  const expected = JSON.parse(asOwner(`select (public.admin_sales_report('${today}', '${today}') -> 'totals')::text`));

  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } })).newPage();
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/reports`);
    const text = await o.locator("main").innerText();
    check(text.includes("Daily closing —"), "opens on today's daily closing");
    check(text.includes(etb(expected.sales)) && text.includes(etb(expected.cash_in)), `sales ${etb(expected.sales)} and money in ${etb(expected.cash_in)} shown`);
    check(Number(expected.orders_paid) >= 1, "today's verified payment is counted");
    check(await o.locator("table").first().locator("tr").count() >= 2, "by bank account table");

    // month
    await o.fill("input[name=value][type=month]", today.slice(0, 7));
    await o.click("button:has-text('Monthly statement')");
    await o.waitForSelector("text=Monthly statement —");
    const days = await o.locator(`a[href^='/admin/reports?kind=day&value=${today.slice(0, 7)}']`).count();
    check(days === Number(today.slice(8, 10)), `month shows each day up to today (${days})`);

    // Excel
    const [dl] = await Promise.all([o.waitForEvent("download"), o.click("a:has-text('Excel')")]);
    check(dl.suggestedFilename() === `sales-month-${today.slice(0, 7)}.xlsx`, `file ${dl.suggestedFilename()}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    check(wb.worksheets.length === 6 && !!wb.getWorksheet("By bank account"), "six sheets");
    const month = JSON.parse(asOwner(`select (public.admin_sales_report('${today.slice(0, 7)}-01', '${today}') -> 'totals')::text`));
    const s = wb.getWorksheet("Summary");
    const col = s.getColumn(1).values;
    check(Math.abs(Number(s.getCell(col.indexOf("Sales (paid orders)"), 2).value) - Number(month.sales)) < 0.01, "Excel sales match the database");
    check(sql("select count(*) from audit_logs where action = 'export_sales' and created_at > now() - interval '2 minutes'") >= "1", "export recorded");

    // print layout: sidebar, header and controls hidden
    await o.emulateMedia({ media: "print" });
    check(!(await o.locator("aside").first().isVisible()) && !(await o.locator("header").first().isVisible()) && !(await o.locator("button:has-text('Daily closing')").isVisible()),
      "printing shows only the report");
    check(await o.locator("h2:has-text('Monthly statement')").isVisible(), "report title printed");
    await o.emulateMedia({ media: "screen" });

    // managers: no access (money)
    const mEmail = `reports-mgr-${RUN}@example.com`;
    const mid = await ensureCustomer(mEmail, "ReportsMgr2026x");
    sql(`insert into profiles (id, full_name, role_id) select '${mid}', 'Reports Manager', id from admin_roles where key = 'manager'`);
    const m = await (await b.newContext()).newPage();
    await adminLogin(m, B, mEmail, "ReportsMgr2026x");
    check((await m.request.get(`${B}/admin/reports/export?kind=day&value=${today}`)).status() === 404, "managers cannot export money reports");
    await m.goto(`${B}/admin/reports`);
    check(!m.url().endsWith("/admin/reports") || (await m.locator("text=Daily closing —").count()) === 0, "managers cannot open money reports");
    check(await m.locator("nav a[href='/admin/reports']").count() === 0, "not in the manager's menu");
    sql(`update profiles set is_active = false where id = '${mid}'`);
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
