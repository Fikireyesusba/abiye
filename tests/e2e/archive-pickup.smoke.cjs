/**
 * (1) Printing documents deleted when the job is marked collected; (2) receipt archive by email (MOCK Resend).
 * Starts its own app instance (port 3104) pointed at the mock, using the existing production build.
 *   npm run build && NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/archive-pickup.smoke.cjs
 * Mutates the LOCAL database only.
 */
const http = require("http");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const PORT = 3104;
const B = `http://localhost:${PORT}`;
const MOCK_PORT = 4599;
const KEY = "re_TestKeyForLocalOnly_1234567890";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }).storage;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const received = [];
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    received.push({ auth: req.headers.authorization, ...JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `email_${received.length}` }));
  });
});
const mails = (to, part) => received.filter((m) => m.to?.[0] === to && (!part || m.subject.includes(part)));
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(300); }
  return false;
}
const asOwner = (q) => sql(`begin; select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = '${OWNER.email}'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated; ${q}; commit;`);

async function paidOrder(cid, ref, bytes) {
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key','${key}',
    'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','Archive Buyer ${RUN}','phone','+251911223398'),'fulfillment',jsonb_build_object('method','pickup'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
  const id = sql(`select id from orders where idempotency_key = '${key}'`);
  const path = `orders/${id}/${crypto.randomUUID()}.png`;
  const up = await storage.from("payment-receipts").upload(path, bytes, { contentType: "image/png" });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  sql(`set role service_role; select public.submit_payment(jsonb_build_object('order_id','${id}','access_token_hash',encode(sha256('a${key}'::bytea),'hex'),
    'transaction_reference','${ref}','receipt',jsonb_build_object('path','${path}','mime','image/png','size',${bytes.length},'sha256','${sha(bytes)}')))`);
  return { id, number: sql(`select order_number from orders where id = '${id}'`), sub: sql(`select id from payment_submissions where order_id = '${id}'`) };
}

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  sql("update notifications_outbox set status = 'dead', last_error = 'e2e reset' where status in ('pending','failed','processing'); delete from rate_limits;");
  sql("update products set stock_quantity = 80 where sku = 'SMP-CH-001'; delete from website_settings where key = 'receipt_archive';");
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, RESEND_API_KEY: KEY, EMAIL_FROM: "Abiye <orders@example.com>", EMAIL_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, APP_URL: B, TELEGRAM_BOT_TOKEN: "", TELEGRAM_ADMIN_CHAT_ID: "" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const logs = [];
  app.stdout.on("data", (d) => logs.push(d.toString()));
  app.stderr.on("data", (d) => logs.push(d.toString()));
  const b = await chromium.launch();
  try {
    if (!(await waitFor(async () => (await fetch(B).catch(() => null))?.ok ?? false, 30000))) throw new Error("app did not start");
    const email = `archive-${RUN}@example.com`;
    const cid = await ensureCustomer(email, "ArchiveE2E2026x");
    const ARCHIVE = `receipts-${RUN}@example.com`;
    const ARCHIVE2 = `receipts2-${RUN}@example.com`;

    // a payment decided BEFORE the archive exists
    const early = await paidOrder(cid, `FTE${RUN}`, Buffer.concat([PNG, Buffer.from("early")]));
    asOwner(`select public.admin_review_payment('${early.sub}', 'verified')`);
    check(sql("select count(*) from notifications_outbox where channel = 'archive' and status = 'pending'") === "0", "nothing queued while the archive is off");

    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);

    // ---- set up the archive
    await o.goto(`${B}/admin/notifications`);
    await o.fill("input[name=email]", "not an email");
    await o.click("button:has-text('Save address')");
    await o.waitForTimeout(800);
    check(sql("select count(*) from website_settings where key = 'receipt_archive'") === "0", "invalid address refused");
    await o.fill("input[name=email]", ARCHIVE.toUpperCase());
    await o.click("button:has-text('Save address')");
    await o.waitForSelector(`text=Receipts will be archived to ${ARCHIVE}`);
    check(sql("select value->>'email' from website_settings where key = 'receipt_archive' and not is_public") === ARCHIVE, "address saved (private)");
    await o.reload();
    await o.click("button:has-text('Send test email')");
    check(await waitFor(() => mails(ARCHIVE, "Test email").length === 1), "test email arrives");
    check(mails(ARCHIVE, "Test email")[0]?.attachments?.[0]?.filename === "sample.txt", "test email carries a sample attachment");

    // ---- verify in the Payments page → archived with the real receipt
    const bytes = Buffer.concat([PNG, Buffer.from(RUN)]);
    const ok = await paidOrder(cid, `FTV${RUN}`, bytes);
    await o.goto(`${B}/admin/payments`);
    await o.click(`a:has-text('${ok.number}')`);
    const card = o.locator("main");
    await card.locator("button:has-text('Verify payment')").click();
    check(await waitFor(() => mails(ARCHIVE, ok.number).length === 1), "verified receipt emailed to the archive right away");
    const m = mails(ARCHIVE, ok.number)[0];
    check(m && m.subject.startsWith("[Receipt archive] VERIFIED") && m.subject.includes(`FTV${RUN}`), `subject: ${m?.subject}`);
    check(m && m.attachments?.length === 1 && Buffer.from(m.attachments[0].content, "base64").equals(bytes) && m.attachments[0].filename === `payment-${ok.number}-verified.png`,
      "the exact receipt file is attached");
    check(m && m.text.includes("Decided by:") && m.text.includes(email) && m.text.includes(sha(bytes)), "who decided, customer and file fingerprint included");

    // ---- reject → archived with the reason
    const bad = await paidOrder(cid, `FTR${RUN}`, Buffer.concat([PNG, Buffer.from(`r${RUN}`)]));
    await o.goto(`${B}/admin/payments`);
    await o.click(`a:has-text('${bad.number}')`);
    const card2 = o.locator("main");
    await card2.locator("textarea[name=note]").fill("Not in our bank statement");
    await card2.locator("button:has-text('Reject')").click();
    check(await waitFor(() => mails(ARCHIVE, bad.number).length === 1), "rejected receipt emailed to the archive");
    check(mails(ARCHIVE, bad.number)[0]?.text.includes("Reason: Not in our bank statement"), "with the rejection reason");

    // ---- send past receipts
    await o.goto(`${B}/admin/notifications`);
    await o.click("summary:has-text('Send past receipts')");
    await o.click("button:has-text('Send receipts')");
    check(await waitFor(() => mails(ARCHIVE, early.number).length === 1), "receipt decided before the archive existed is sent");
    await o.reload();
    await o.click("summary:has-text('Send past receipts')");
    await o.click("button:has-text('Send receipts')");
    await o.waitForSelector("text=Nothing new to send");
    check(mails(ARCHIVE, ok.number).length === 1 && mails(ARCHIVE, early.number).length === 1, "nothing is sent twice");

    // ---- change address → old one is told
    await o.fill("input[name=email]", ARCHIVE2);
    await o.click("button:has-text('Save address')");
    check(await waitFor(() => mails(ARCHIVE, "Archive address changed").length === 1), "previous address notified of the change");
    check(sql("select count(*) from audit_logs where action = 'receipt_archive_set' and after_data->>'email' = '" + ARCHIVE2 + "'") === "1", "change in the Activity log");

    // ---- (1) printing: collected → documents deleted
    const jobId = sql("select gen_random_uuid()");
    const docPath = `jobs/${jobId}/doc.pdf`;
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const upd = await storage.from("printing-files").upload(docPath, pdf, { contentType: "application/pdf" });
    if (upd.error) throw new Error(`doc upload: ${upd.error.message}`);
    sql(`set role service_role; select public.create_printing_job_for_user('${cid}', jsonb_build_object('id','${jobId}','access_token_hash',encode(sha256('job-${jobId}'::bytea),'hex'),
      'customer',jsonb_build_object('full_name','Print ${RUN}','phone','+251933445566'),'color_mode','bw','paper_size','A4','sides','single','copies',1,'fulfillment_method','pickup',
      'files',jsonb_build_array(jsonb_build_object('path','${docPath}','original_name','thesis.pdf','mime','application/pdf','size',${pdf.length},'sha256','${sha(pdf)}','page_count',2))))`);
    sql(`update printing_jobs set status = 'printing' where id = '${jobId}'; update printing_jobs set status = 'ready' where id = '${jobId}';`);
    await o.goto(`${B}/admin/printing/${jobId}`);
    check(await o.locator("button:has-text('Mark collected / delivered (deletes documents)')").count() === 1, "button says the documents will be deleted");
    await o.click("button:has-text('Mark collected / delivered')");
    await o.waitForSelector("[data-sonner-toast]:has-text('1 document deleted')");
    check(sql(`select status || '|' || (files_deleted_at is not null) from printing_jobs where id = '${jobId}'`) === "completed|true", "job completed, files recorded as deleted");
    const dl = await storage.from("printing-files").download(docPath);
    check(!dl.data, "the document is gone from storage");
    check(sql(`select count(*) from audit_logs where action = 'printing_files_deleted' and entity_id = '${jobId}'`) === "1", "deletion recorded in the Activity log");
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "ArchiveE2E2026x");
    await c.goto(`${B}/printing/jobs/${jobId}`);
    check((await c.locator("main").innerText()).includes("Your files have been deleted from our system."), "customer sees the files were deleted");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
    console.log(logs.join("").slice(-2000));
  } finally {
    await b.close();
    sql("delete from website_settings where key = 'receipt_archive'");
    try { process.kill(-app.pid, "SIGTERM"); } catch {}
    mock.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
