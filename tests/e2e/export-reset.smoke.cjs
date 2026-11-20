/**
 * Export everything + reset test data. WIPES local orders/customers (keeps products, settings, staff) — run last.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/export-reset.smoke.cjs
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const ExcelJS = require("exceljs");
const { createClient } = require("@supabase/supabase-js");
const { adminLogin, nextCode } = require("./_admin.cjs");
const { ensureCustomer } = require("./_customer.cjs");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }).storage;
const secret = () => JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "abiye-e2e-totp.json"), "utf8"))[OWNER.email];
const toast = (p, text) => p.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 30000 });

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  // Start from "no recent export" (test-only: old export records removed).
  sql("alter table audit_logs disable trigger audit_logs_immutable; delete from audit_logs where action = 'export_all'; alter table audit_logs enable trigger audit_logs_immutable;");
  const email = `reset-${RUN}@example.com`;
  const cid = await ensureCustomer(email, "ResetE2E2026x");
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key','${key}',
    'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','Reset Buyer ${RUN}','phone','+251911223395'),'fulfillment',jsonb_build_object('method','pickup'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
  const oid = sql(`select id from orders where idempotency_key = '${key}'`);
  const receipt = `orders/${oid}/${crypto.randomUUID()}.png`;
  await storage.from("payment-receipts").upload(receipt, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), { contentType: "image/png" });
  sql(`set role service_role; select public.submit_payment(jsonb_build_object('order_id','${oid}','access_token_hash',encode(sha256('a${key}'::bytea),'hex'),
    'transaction_reference','FTRESET${RUN}','receipt',jsonb_build_object('path','${receipt}','mime','image/png','size',70,'sha256',encode(sha256('reset${RUN}'::bytea),'hex'))))`);
  const before = { products: sql("select count(*) from products"), staff: sql("select count(*) from profiles"), banks: sql("select count(*) from bank_accounts") };

  const b = await chromium.launch();
  try {
    // managers: no access
    const mEmail = `reset-mgr-${RUN}@example.com`;
    const mid = await ensureCustomer(mEmail, "ResetMgr2026x");
    sql(`insert into profiles (id, full_name, role_id) select '${mid}', 'Reset Manager', id from admin_roles where key = 'manager'`);
    const m = await (await b.newContext()).newPage();
    await adminLogin(m, B, mEmail, "ResetMgr2026x");
    check((await m.request.get(`${B}/admin/data/export`)).status() === 404, "managers cannot export everything");
    check(await m.locator("nav a[href='/admin/data']").count() === 0, "not in the manager's menu");

    const o = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/data`);
    check(await o.locator("text=Download “Export everything” first").count() === 1 && await o.locator("input[name=phrase]").count() === 0, "reset locked until you export");

    // export
    const [dl] = await Promise.all([o.waitForEvent("download", { timeout: 60000 }), o.click("a:has-text('Export everything')")]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    check(wb.worksheets.length === 30 && wb.worksheets[0].name === "About", `About + 29 data sheets (${wb.worksheets.length})`);
    const orders = wb.getWorksheet("Orders");
    const header = orders.getRow(1).values.filter(Boolean);
    let found = false;
    orders.eachRow((r) => { if (r.values.includes(oid)) found = true; });
    check(found, "the test order is in the export");
    check(!header.includes("access_token_hash") && !header.includes("tracking_code_hash"), "no secrets in the export");
    let emailFound = false;
    wb.getWorksheet("Customer accounts").eachRow((r) => { if (r.values.includes(email)) emailFound = true; });
    check(emailFound, "customer accounts include emails");

    // reset: wrong phrase, wrong code, then correct
    await o.reload();
    const phrase = (await o.locator("label:has(input[name=phrase]) code").innerText()).trim();
    check(/^RESET /.test(phrase), `phrase shown (${phrase})`);
    await o.fill("input[name=phrase]", "RESET");
    await o.fill("input[name=code]", "000000");
    await o.check("input[name=understood]");
    await o.click("button:has-text('Reset test data')");
    await toast(o, "Type exactly");
    check(sql("select count(*) from orders") !== "0", "wrong phrase: nothing deleted");
    await o.fill("input[name=phrase]", phrase);
    await o.fill("input[name=code]", "000000");
    await o.click("button:has-text('Reset test data')");
    await toast(o, "authenticator code is not correct");
    check(sql("select count(*) from orders") !== "0", "wrong code: nothing deleted");
    await o.fill("input[name=code]", await nextCode(OWNER.email, secret()));
    await o.click("button:has-text('Reset test data')");
    await toast(o, "Reset done");
    check(sql("select count(*) from orders") === "0" && sql("select count(*) from payment_submissions") === "0", "orders and payments removed");
    check(sql(`select count(*) from auth.users where email = '${email}'`) === "0", "customer account removed");
    check(sql("select count(*) from products") === before.products && sql("select count(*) from profiles") === String(Number(before.staff) + 1) && sql("select count(*) from bank_accounts") === before.banks,
      "products, staff and bank accounts kept");
    const file = await storage.from("payment-receipts").download(receipt);
    check(!file.data, "receipt files removed from storage");
    check(sql("select count(*) from audit_logs where action = 'data_reset'") >= "1", "reset recorded");
    check(sql("select last_value || '/' || is_called from public.order_number_seq") === "10001/false", "next order is ET-10001");
    await o.reload();
    check((await o.locator("main").innerText()).includes("Previous resets"), "reset history shown");
    // the owner is still signed in and can work
    await o.goto(`${B}/admin/orders`);
    check(new URL(o.url()).pathname === "/admin/orders", "admin still works after the reset");
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
