/**
 * Staff performance: KPI table per staff member, Super Admin sets targets, Excel export.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/kpi.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const ExcelJS = require("exceljs");
const { adminLogin } = require("./_admin.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);

(async () => {
  sql("delete from rate_limits where true; delete from kpi_targets where true");
  const ownerMid = sql("select a.member_id from customer_accounts a join auth.users u on u.id = a.id where u.email = 'owner@abiye.local'");
  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/performance`);
    check(await o.locator(`tr:has-text("${ownerMid}")`).count() === 1, "KPI table lists each staff member by User ID");
    check(await o.locator("th", { hasText: "Tickets resolved" }).count() === 1 && await o.locator("th", { hasText: "Payments approved" }).count() === 1
      && await o.locator("th", { hasText: "Ticket resolution time" }).count() === 1, "KPI columns: tickets, payments, resolution time …");
    await o.goto(`${B}/admin/performance?tab=targets`);
    await o.selectOption("select[name=metric]", "payments_approved");
    await o.fill("input[name=target]", "10");
    await o.selectOption("select[name=period]", "day");
    await o.click("form button:has-text('Save target')");
    await o.waitForSelector("[data-sonner-toast]:has-text('Target saved')");
    check(sql("select target || '/' || period || '/' || (profile_id is null) from kpi_targets where metric = 'payments_approved'") === "10.00/day/true", "Super Admin set a target for every staff member");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
    await o.goto(`${B}/admin/performance?from=${today}&to=${today}`);
    check((await o.locator(`tr:has-text("${ownerMid}")`).innerText()).includes("target 10"), "the target and % reached are shown per person");
    const [dl] = await Promise.all([o.waitForEvent("download"), o.click("[data-testid=kpi-export]")]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    let found = false;
    wb.worksheets[0].eachRow((r) => { if (String(r.getCell(1).value) === ownerMid) found = true; });
    check(found && sql("select count(*) from audit_logs where action = 'export_kpi' and created_at > now() - interval '2 minutes'") >= "1", "KPI Excel export (recorded)");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    sql("delete from kpi_targets where true");
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
