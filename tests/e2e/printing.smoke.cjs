/**
 * Printing service end-to-end against LOCAL Supabase + app on BASE_URL.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/printing.smoke.cjs
 * Mutates the local database. Never point it at production.
 */
const { chromium } = require("playwright");
const { adminLogin } = require("./_admin.cjs");
const { execSync } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function pdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 780 });
  return Buffer.from(await doc.save());
}
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });

async function fillContact(p, name, phone) {
  await p.fill("#pfullName", name);
  await p.fill("#pphone", phone);
}

(async () => {
  sql("delete from rate_limits; update printing_price_rules set price_per_page_etb = 3, is_active = true where color_mode = 'bw' and paper_size = 'A4' and sides = 'single'");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  await ensureCustomer("printing-e2e@example.com", "Printing2026e2e");
  await loginCustomer(p, B, "printing-e2e@example.com", "Printing2026e2e");
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));

  // ---- 1. Priced PDF job
  await p.goto(`${B}/printing`);
  check((await p.locator("table").textContent()).includes("A4"), "price list shown on /printing");
  await p.setInputFiles("#print-files", [{ name: "thesis.pdf", mimeType: "application/pdf", buffer: await pdf(3) }]);
  await p.waitForSelector("li:has-text('thesis.pdf'):has-text('3 pages')");
  check(true, "browser estimates 3 pages for the PDF");
  await p.selectOption("#colorMode", "color");
  await p.selectOption("#sides", "double");
  await p.fill("#copies", "2");
  await p.waitForSelector("aside:has-text('60 ETB')");
  check(true, "live estimate: 3 pages × 2 copies × 10 ETB = 60 ETB");
  await fillContact(p, "Meron Print", "0911 55 66 77");
  await p.click("aside button[type=submit]");
  await p.waitForURL(/\/printing\/jobs\//, { timeout: 30000 });
  const job1 = p.url().split("/printing/jobs/")[1];
  check(sql(`select page_count || '/' || page_count_source || '/' || total_etb || '/' || status from printing_jobs where id = '${job1}'`) === "3/auto/60.00/awaiting_payment",
    "server recounted pages and priced the job (60 ETB)");
  check(sql(`select count(*) from storage.objects where bucket_id = 'printing-files' and name like 'jobs/${job1}/%'`) === "1", "document stored in the private bucket");
  check(sql(`select count(*) from notifications_outbox where dedupe_key = 'printing_job:${job1}'`) === "1", "staff notification queued");
  const priv = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/printing-files/${sql(`select storage_path from printing_files where job_id = '${job1}'`)}`);
  check(priv.status >= 400, `customer document not publicly reachable (${priv.status})`);
  check((await p.locator("text=60 ETB").count()) > 0 && (await p.locator("button:has-text('Add to basket')").count()) === 1, "job page shows price and Add to basket");

  // ---- 2. Forged file (HTML disguised as PDF)
  await p.goto(`${B}/printing`);
  await p.setInputFiles("#print-files", [{ name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>".padEnd(300)) }]);
  await fillContact(p, "Evil Person", "0911 00 00 01");
  const before = sql("select count(*) from printing_jobs");
  await p.click("aside button[type=submit]");
  await p.waitForSelector("aside [role=alert]");
  check((await p.locator("aside [role=alert]").textContent()).includes("JPG, PNG or PDF"), "disguised file rejected by content check");
  check(sql("select count(*) from printing_jobs") === before, "no job created for the forged upload");
  check(sql("select count(*) from storage.objects o where bucket_id = 'printing-files' and not exists (select 1 from printing_files f where f.storage_path = o.name)") === "0",
    "forged upload deleted from storage");

  // ---- 3. Word document → needs a quote
  await p.goto(`${B}/printing`);
  const fakeDocx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(400, 1)]);
  await p.setInputFiles("#print-files", [{ name: "report.docx", mimeType: DOCX, buffer: fakeDocx }]);
  await fillContact(p, "Yonas Docx", "0911 22 00 33");
  await p.click("aside button[type=submit]");
  await p.waitForURL(/\/printing\/jobs\//, { timeout: 30000 });
  const job2 = p.url().split("/printing/jobs/")[1];
  check(sql(`select status from printing_jobs where id = '${job2}'`) === "awaiting_quote", "Word document goes to Awaiting quote");
  check((await p.locator("text=We are preparing your quote").count()) === 1 && (await p.locator("button:has-text('Add to basket')").count()) === 0,
    "customer sees quote notice and cannot pay yet");

  // ---- 4. Basket + checkout with the priced job and a product
  await p.goto(`${B}/printing/jobs/${job1}`);
  await p.click("button:has-text('Add to basket')");
  await p.waitForSelector("text=In your basket");
  await p.goto(`${B}/products/sample-usb-c-cable-1m`);
  await p.click("main button:has-text('Add to basket')");
  await p.goto(`${B}/cart`);
  await p.waitForSelector(`text=Printing job`);
  check((await p.locator("ul.divide-y > li").count()) === 2, "basket shows printing job + product");
  await p.check("input[type=radio] >> nth=1"); // pickup
  check((await p.locator("dl div:has(dt:text-is('Total')) dd").textContent()) === "310 ETB", "basket total: 60 printing + 250 cable");
  await p.goto(`${B}/checkout`);
  await p.waitForSelector("text=Order summary");
  await p.check("label:has-text('I agree') input[type=checkbox]");
  await p.fill("#fullName", "Meron Print");
  await p.fill("#phone", "0911556677");
  await p.click("button[type=submit]");
  await p.waitForURL(/\/order-success\//, { timeout: 20000 });
  const orderId = p.url().split("/order-success/")[1];
  check(sql(`select total_etb from orders where id = '${orderId}'`) === "310.00", "order total includes the printing job (310 ETB)");
  check(sql(`select order_id from printing_jobs where id = '${job1}'`) === orderId, "printing job attached to the order");
  await p.goto(`${B}/printing/jobs/${job1}`);
  check((await p.locator("text=Included in order").count()) === 1 && (await p.locator("button:has-text('Add to basket')").count()) === 0,
    "job page links to its order and can't be added twice");

  // ---- 5. Admin: quote the Word job, pay + produce the PDF job
  const a = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  a.on("dialog", (d) => d.accept());
  await adminLogin(a, B, OWNER.email, OWNER.password);
  await a.goto(`${B}/admin/printing`);
  check((await a.locator(`tr:has-text("Yonas Docx")`).count()) === 1, "Word job listed under Needs action");
  await a.goto(`${B}/admin/printing/${job2}`);
  const dl = await a.locator("a:has-text('Download')").getAttribute("href");
  const dlRes = await fetch(dl);
  check(dlRes.status === 200 && /attachment/.test(dlRes.headers.get("content-disposition") ?? ""), "staff download via short-lived signed link works");
  await a.fill("input[name=pageCount]", "12");
  await a.locator("form:has(input[name=pageCount]) button[type=submit]").click();
  await a.waitForSelector("[role=status]:has-text('Quote saved')");
  check(sql(`select status || '/' || total_etb || '/' || page_count_source from printing_jobs where id = '${job2}'`) === "awaiting_payment/36.00/admin",
    "staff quote: 12 pages × 1 × 3 ETB = 36 ETB");
  await p.goto(`${B}/printing/jobs/${job2}`);
  check((await p.locator("text=36 ETB").count()) > 0 && (await p.locator("button:has-text('Add to basket')").count()) === 1, "customer sees the quote and can now pay");

  // pay the order (customer submits proof via SQL helper), admin verifies in the UI
  const key = sql(`select idempotency_key from orders where id = '${orderId}'`);
  sql(`update orders set access_token_hash = encode(sha256('e2e-${key}'::bytea),'hex') where id = '${orderId}';
       set role service_role; select public.submit_payment(jsonb_build_object('order_id','${orderId}','access_token_hash',encode(sha256('e2e-${key}'::bytea),'hex'),
       'receipt',jsonb_build_object('path','orders/${orderId}/r.png','mime','image/png','size',10,'sha256',encode(sha256('${RUN}'::bytea),'hex'))))`);
  check(sql(`select status from printing_jobs where id = '${job1}'`) === "payment_verification", "job → Payment verification when proof submitted");
  await a.goto(`${B}/admin/payments`);
  await a.locator(`li:has-text("${sql(`select order_number from orders where id = '${orderId}'`)}") form:has(button:has-text('Verify payment')) button`).click();
  await toast(a, "Payment verified");
  check(sql(`select status from printing_jobs where id = '${job1}'`) === "printing", "verified payment sends the job to Printing");
  await a.goto(`${B}/admin/printing/${job1}`);
  check((await a.locator("button:has-text('Delete customer files now')").count()) === 0, "files cannot be deleted while printing");
  await a.locator("form:has(button:has-text('Mark ready')) button").click();
  await toast(a, "status updated");
  await p.goto(`${B}/printing/jobs/${job1}`);
  check((await p.locator("text=Your printing is ready").count()) === 1, "customer sees 'ready'");
  await a.locator("form:has(button:has-text('Mark collected')) button").click();
  await toast(a, "status updated");
  check(sql(`select status from printing_jobs where id = '${job1}'`) === "completed", "job completed");

  // ---- 6. Prices editor
  await a.goto(`${B}/admin/printing/prices`);
  const row = a.locator("li form").filter({ has: a.locator("input[name=paper_size][value='A4']") }).first();
  await row.locator("input[name=price_per_page_etb]").fill("4");
  await row.locator("button[type=submit]").click();
  await toast(a, "Price saved");
  await p.goto(`${B}/printing`);
  check((await p.locator("table").textContent()).includes("4 ETB"), "price change appears on /printing");
  sql("update printing_price_rules set price_per_page_etb = 3 where color_mode = 'bw' and paper_size = 'A4' and sides = 'single'");
  check(sql(`select total_etb from printing_jobs where id = '${job2}'`) === "36.00", "existing quotes keep their price");

  // ---- 7. Retention
  sql(`update printing_jobs set files_delete_after = now() - interval '1 minute' where id = '${job1}'`);
  check((await fetch(`${B}/api/cron/printing-retention`)).status === 401, "retention cron rejects unauthenticated calls");
  const cron = await (await fetch(`${B}/api/cron/printing-retention`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
  check(cron.deleted >= 1, `retention cron deleted expired files (${JSON.stringify(cron)})`);
  check(sql(`select count(*) from storage.objects where bucket_id = 'printing-files' and name like 'jobs/${job1}/%'`) === "0", "storage objects removed");
  await p.goto(`${B}/printing/jobs/${job1}`);
  check((await p.locator("text=deleted").count()) > 0, "customer sees the file was deleted");

  // ---- 8. Access control
  const o = await (await b.newContext()).newPage();
  await o.goto(`${B}/printing/jobs/${job2}`);
  check((await o.locator("text=Printing job not found").count()) === 1, "another browser without the link cannot open the job");
  const mgrPage = await (await b.newContext()).newPage();
  await mgrPage.goto(`${B}/admin/printing/prices`);
  check(mgrPage.url().includes("/admin/login"), "price editor requires sign-in");

  // ---- 9. Mobile
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await m.context().addCookies(await ctx.cookies());
  const wide = [];
  for (const path of ["/printing", `/printing/jobs/${job2}`]) {
    await m.goto(B + path);
    if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(path);
  }
  check(wide.length === 0, `no horizontal overflow on phones (${wide.join(", ")})`);

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  console.log(results.join("\n"));
  await b.close();
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})().catch((e) => {
  console.log(results.join("\n"));
  console.error(e);
  process.exit(1);
});
