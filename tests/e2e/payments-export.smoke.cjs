/**
 * Payments → Excel export of verified and rejected payments (+ wallet top-ups for Manager/Super Admin):
 * download from the Payments page, open the real .xlsx, compare with the database; filters, permissions, audit.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/payments-export.smoke.cjs
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
const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const asOwner = (q) => sql(`begin; select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = '${OWNER.email}'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated; ${q}; commit;`);

function paidOrder(cid, ref) {
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key','${key}',
    'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','ሰላም ተስፋዬ ${RUN}','phone','+251911223399'),'fulfillment',jsonb_build_object('method','pickup'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
  const id = sql(`select id from orders where idempotency_key = '${key}'`);
  sql(`set role service_role; select public.submit_payment(jsonb_build_object('order_id','${id}','access_token_hash',encode(sha256('a${key}'::bytea),'hex'),
    'transaction_reference','${ref}','receipt',jsonb_build_object('path','orders/${id}/${ref}.png','mime','image/png','size',100,'sha256',encode(sha256('${ref}'::bytea),'hex'))))`);
  return { id, number: sql(`select order_number from orders where id = '${id}'`), sub: sql(`select id from payment_submissions where order_id = '${id}'`) };
}
async function xlsx(res) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.body());
  return wb;
}
const rowsOf = (ws) => { const out = []; ws.eachRow((r, i) => { if (i > 1) out.push(r); }); return out; };

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const email = `payexp-${RUN}@example.com`;
  const cid = await ensureCustomer(email, "PayExport2026x");
  const ok = paidOrder(cid, `FTV${RUN}`);
  const bad = paidOrder(cid, `FTR${RUN}`);
  const pending = paidOrder(cid, `FTP${RUN}`);
  asOwner(`select public.admin_review_payment('${ok.sub}', 'verified')`);
  asOwner(`select public.admin_review_payment('${bad.sub}', 'rejected', 'Amount not found in bank statement')`);
  const expected = Number(sql(`select count(*) from payment_submissions where status in ('verified','rejected') and reviewed_at >= '${today}T00:00:00+03:00'`));
  const expectedTopups = Number(sql(`select count(*) from wallet_topups where status in ('verified','rejected') and reviewed_at >= '${today}T00:00:00+03:00'`));

  const b = await chromium.launch();
  try {
    const p = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } })).newPage();
    await adminLogin(p, B, OWNER.email, OWNER.password);
    await p.goto(`${B}/admin/payments?status=verified`);
    await p.click("summary:has-text('Export verified')");
    await p.fill("input[name=from]", today);
    await p.fill("input[name=to]", today);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('Download .xlsx')")]);
    check(dl.suggestedFilename() === `payments-${today}_to_${today}.xlsx`, `file name ${dl.suggestedFilename()}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    check(wb.worksheets.map((w) => w.name).join(",") === "Summary,Order payments,Wallet top-ups", "sheets: Summary, Order payments, Wallet top-ups");
    const rows = rowsOf(wb.getWorksheet("Order payments"));
    check(rows.length === expected, `all of today's reviewed payments exported (${rows.length} / ${expected})`);
    check(rowsOf(wb.getWorksheet("Wallet top-ups")).length === expectedTopups, `today's reviewed top-ups exported (${expectedTopups})`);
    const v = rows.find((r) => r.getCell(5).value === ok.number);
    const r = rows.find((x) => x.getCell(5).value === bad.number);
    check(!!v && v.getCell(1).value === "Verified" && v.getCell(3).value && v.getCell(9).value === email && v.getCell(10).value === 850
      && v.getCell(14).value === `FTV${RUN}` && v.getCell(2).value instanceof Date, "verified row: decided by, customer email, amount, reference, date");
    check(!!r && r.getCell(1).value === "Rejected" && r.getCell(4).value === "Amount not found in bank statement", "rejected row with the reason");
    check(!rows.some((x) => x.getCell(5).value === pending.number), "payments still waiting are not included");
    check(sql(`select count(*) from audit_logs where action = 'export_payments' and metadata->>'from' = '${today}' and created_at > now() - interval '2 minutes'`) >= "1",
      "export recorded in the Activity log");

    // filters
    const rej = await xlsx(await p.request.get(`${B}/admin/payments/export?from=${today}&to=${today}&status=rejected&topups=1`));
    check(rowsOf(rej.getWorksheet("Order payments")).every((x) => x.getCell(1).value === "Rejected") && rowsOf(rej.getWorksheet("Order payments")).length >= 1, "rejected-only filter");
    const noTop = await xlsx(await p.request.get(`${B}/admin/payments/export?from=${today}&to=${today}&status=all`));
    check(!noTop.getWorksheet("Wallet top-ups"), "top-ups left out when not ticked");
    check((await p.request.get(`${B}/admin/payments/export?from=${today}&to=${today}&status=pending`)).status() === 400, "pending filter refused");
    check((await p.request.get(`${B}/admin/payments/export?from=2024-01-01&to=2026-01-01`)).status() === 400, "more than a year refused");

    // staff (no payments access) cannot export; signed-out cannot either
    const sEmail = `payexp-staff-${RUN}@example.com`;
    const sid = await ensureCustomer(sEmail, "PayExpStaff2026x");
    sql(`insert into profiles (id, full_name, role_id) select '${sid}', 'Pay Export Staff', id from admin_roles where key = 'staff'`);
    const s = await (await b.newContext()).newPage();
    await adminLogin(s, B, sEmail, "PayExpStaff2026x");
    check((await s.request.get(`${B}/admin/payments/export?from=${today}&to=${today}`)).status() === 404, "staff cannot export payments");
    const anon = await (await b.newContext()).newPage();
    const a = await anon.request.get(`${B}/admin/payments/export?from=${today}&to=${today}`, { maxRedirects: 0 });
    check(a.status() === 307 || a.status() === 404, `signed-out request refused (${a.status()})`);
    sql(`update profiles set is_active = false where id = '${sid}'`);
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
