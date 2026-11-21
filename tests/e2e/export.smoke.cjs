/**
 * Orders → Excel export: download from the Orders page, open the real .xlsx,
 * compare with the database; permissions and audit.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/export.smoke.cjs
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

(async () => {
  sql("delete from rate_limits");
  // An order with an Amharic name today
  const cid = await ensureCustomer(`export-${RUN}@example.com`, "ExportE2E2026x");
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key','${key}',
    'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','ሰላም ተስፋዬ ${RUN}','phone','+251911223399'),'fulfillment',jsonb_build_object('method','pickup'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',2))))`);
  const number = sql(`select order_number from orders where idempotency_key = '${key}'`);
  const expected = Number(sql(`select count(*) from orders where created_at >= (timestamp '${today} 00:00' at time zone 'Europe/Warsaw')`));

  const b = await chromium.launch();
  try {
    const p = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } })).newPage();
    await adminLogin(p, B, OWNER.email, OWNER.password);
    await p.goto(`${B}/admin/orders`);
    await p.click("summary:has-text('Export to Excel')");
    await p.fill("input[name=from]", today);
    await p.fill("input[name=to]", today);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('Download .xlsx')")]);
    check(dl.suggestedFilename() === `orders-${today}_to_${today}.xlsx`, `file name ${dl.suggestedFilename()}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    check(wb.worksheets.map((w) => w.name).join(",") === "Summary,Orders,Items", "sheets: Summary, Orders, Items");
    const ws = wb.getWorksheet("Orders");
    check(ws.rowCount - 1 === expected, `all of today's orders exported (${ws.rowCount - 1} / ${expected})`);
    let row = null;
    ws.eachRow((r) => { if (r.getCell(1).value === number) row = r; });
    check(!!row && row.getCell(5).value === `ሰላም ተስፋዬ ${RUN}` && row.getCell(15).value === 1700 && row.getCell(10).value === 2,
      "order row: Amharic name, total 1700 as a number, 2 items");
    check(row && row.getCell(2).value instanceof Date, "placed date is a real Excel date");
    let itemRows = 0;
    wb.getWorksheet("Items").eachRow((r) => { if (r.getCell(1).value === number) itemRows++; });
    check(itemRows === 1, "items sheet lists the order's lines");
    check(sql(`select count(*) from audit_logs where action = 'export_orders' and metadata->>'from' = '${today}' and created_at > now() - interval '2 minutes'`) >= "1",
      "export recorded in the Activity log");

    // paid-only filter
    const paidExpected = Number(sql(`select count(*) from orders where created_at >= (timestamp '${today} 00:00' at time zone 'Europe/Warsaw') and payment_status = 'verified'`));
    const paid = await p.request.get(`${B}/admin/orders/export?from=${today}&to=${today}&status=paid`);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(await paid.body());
    check(wb2.getWorksheet("Orders").rowCount - 1 === paidExpected, `paid-only filter (${paidExpected})`);
    // invalid input
    check((await p.request.get(`${B}/admin/orders/export?from=2026-02-01&to=2026-01-01`)).status() === 400, "invalid range refused");
    check((await p.request.get(`${B}/admin/orders/export?from=2024-01-01&to=2026-01-01`)).status() === 400, "more than a year refused");

    // staff (assigned orders only) cannot export; signed-out cannot either
    const sEmail = `export-staff-${RUN}@example.com`;
    const sid = await ensureCustomer(sEmail, "ExportStaff2026x");
    sql(`insert into profiles (id, full_name, role_id) select '${sid}', 'Export Staff', id from admin_roles where key = 'staff'`);
    const s = await (await b.newContext()).newPage();
    await adminLogin(s, B, sEmail, "ExportStaff2026x");
    check((await s.request.get(`${B}/admin/orders/export?from=${today}&to=${today}`)).status() === 404, "staff cannot export");
    await s.goto(`${B}/admin/orders`);
    check(await s.locator("summary:has-text('Export to Excel')").count() === 0, "staff do not see the export panel");
    const anon = await (await b.newContext()).newPage();
    const r = await anon.request.get(`${B}/admin/orders/export?from=${today}&to=${today}`, { maxRedirects: 0 });
    check(r.status() === 307 || r.status() === 404, `signed-out request refused (${r.status()})`);
    sql(`update profiles set is_active = false where id = '${sid}'`);
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
