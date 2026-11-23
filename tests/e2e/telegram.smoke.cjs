/**
 * Telegram notifications end-to-end with a MOCK Telegram Bot API (no real bot needed).
 * Starts its own app instance (port 3101) pointed at the mock, using the existing production build.
 *   npm run build && NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/telegram.smoke.cjs
 * Mutates the LOCAL database only.
 */
const http = require("http");
const { spawn, execSync } = require("child_process");
const { chromium } = require("playwright");
const { adminLogin } = require("./_admin.cjs");
const { PDFDocument } = require("pdf-lib");
const { ensureCustomer, loginCustomer, fillIfEditable } = require("./_customer.cjs");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const PORT = 3101;
const B = `http://localhost:${PORT}`;
const MOCK_PORT = 4599;
const TOKEN = "7000000001:AAFakeTokenForLocalTestsOnly_abcdefghijk";
const CHAT = "-1001234567890";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- mock Bot API
const received = [];
let mode = "ok"; // ok | fail500 | rate429once
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
    const entry = { token: m?.[1], method: m?.[2], contentType: req.headers["content-type"] ?? "", size: body.length };
    if (entry.contentType.startsWith("application/json")) Object.assign(entry, JSON.parse(body.toString("utf8")));
    else {
      const text = body.toString("utf8");
      entry.chat_id = text.match(/name="chat_id"\r\n\r\n([^\r]*)/)?.[1];
      entry.caption = text.match(/name="caption"\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
      entry.hasFile = /name="(photo|document)"; filename="/.test(text);
      entry.fileField = text.match(/name="(photo|document)"; filename="/)?.[1];
    }
    received.push(entry);
    const reply = (status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    if (entry.token !== TOKEN) return reply(401, { ok: false, description: "Unauthorized" });
    if (mode === "fail500") return reply(502, { ok: false, description: "Bad Gateway" });
    if (mode === "rate429once") { mode = "ok"; return reply(429, { ok: false, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } }); }
    return reply(200, { ok: true, result: { message_id: received.length } });
  });
});

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}
const cron = (auth = true) => fetch(`${B}/api/cron/notifications`, { headers: auth ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {} });

(async () => {
  // These tests cover the "payment waiting for approval" alerts (off by default since 0057): switch them on for the run.
  require("child_process").execSync(`psql -q "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`, { input: `insert into website_settings (key, value, is_public) values ('telegram_feed', '{"pending_payments": true}', false) on conflict (key) do update set value = website_settings.value || excluded.value;` });
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  // Quiet the queue: earlier local test runs left unsent rows (Telegram was not configured).
  sql("update notifications_outbox set status = 'dead', last_error = 'e2e reset' where status in ('pending','failed','processing'); delete from rate_limits;");
  // This suite checks the order-progress messages (payment decisions, cancellations): switch them on (default off).
  sql(`insert into website_settings (key, value, is_public) values ('telegram_feed', '{"order_progress": true}', false)
       on conflict (key) do update set value = website_settings.value || excluded.value`);
  sql(`update products p set stock_quantity = 80 where sku = 'SMP-CH-001'`);

  const logs = [];
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_ADMIN_CHAT_ID: CHAT, TELEGRAM_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, APP_URL: B },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so the whole tree (npx -> next-server) can be stopped
  });
  app.stdout.on("data", (d) => logs.push(d.toString()));
  app.stderr.on("data", (d) => logs.push(d.toString()));
  if (!(await waitFor(async () => (await fetch(B).catch(() => null))?.ok ?? false, 30000))) throw new Error("app did not start");

  const b = await chromium.launch();
  try {
    const p = await (await b.newContext()).newPage();
    await ensureCustomer("telegram-e2e@example.com", "Telegram2026e2e");
    await loginCustomer(p, B, "telegram-e2e@example.com", "Telegram2026e2e");
    // The account's own name / phone are used for orders (with HTML in it: must be escaped in Telegram).
    sql(`update customer_accounts set full_name = '<a href="https://phish.example">Click</a> & Co', phone = '+251911765432' where id = (select id from auth.users where email = 'telegram-e2e@example.com')`);

    // ---- 1. New order + receipt → photo with caption, sent immediately (no cron)
    await p.goto(B);
    await p.evaluate(() => {
      localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: "20000000-0000-0000-0000-000000000007", quantity: 2 }]));
      localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "delivery", deliveryZoneId: "40000000-0000-0000-0000-000000000001" }));
    });
    await p.goto(`${B}/checkout`);
    await p.waitForSelector("text=Order summary");
    await p.check("label:has-text('I agree') input[type=checkbox]");
    await fillIfEditable(p, "#fullName", '<a href="https://phish.example">Click</a> & Co');
    await fillIfEditable(p, "#phone", "0911 76 54 32");
    await p.fill("#addressLine", "Bole, near Edna Mall");
    await p.click("button[type=submit]");
    await p.waitForURL(/order-success/);
    const orderNumber = (await p.locator("h1").textContent()).replace("Order ", "");
    await p.fill("#reference", "FT26TG0001");
    await p.setInputFiles("#receipt", { name: "receipt.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    await p.click("button:has-text('Submit payment proof')");
    await p.waitForSelector("text=We are verifying your payment");
    check(await waitFor(() => received.some((r) => r.caption?.includes(orderNumber))), "new-order alert delivered right after the receipt upload (no cron needed)");
    const photo = received.find((r) => r.caption?.includes(orderNumber));
    check(photo?.method === "sendPhoto" && photo.hasFile && photo.chat_id === CHAT, "sent as a photo with the receipt attached, to the configured chat");
    for (const s of ["NEW CUSTOMER ORDER", `Order ID: ${orderNumber}`, "Phone: +251 91 176 5432", "25W USB-C Fast Charger × 2", "Total: <b>1,850 ETB</b>",
      "Payment Method: Bank Transfer", "Transaction Reference: FT26TG0001", "Payment Status: Pending Verification", "Delivery Address: Addis Ababa — Bole, near Edna Mall",
      `href="${B}/admin/orders/`]) {
      check(photo?.caption?.includes(s), `caption contains “${s}”`);
    }
    check(photo?.caption?.includes("&lt;a href=&quot;https://phish.example&quot;&gt;Click&lt;/a&gt; &amp; Co") && !photo.caption.includes('<a href="https://phish'),
      "customer-supplied HTML is escaped (no link injection into the staff chat)");
    check(sql(`select status from notifications_outbox where payload->>'order_number' = '${orderNumber}' and event_type = 'new_order'`) === "sent", "outbox row marked sent");

    // ---- 2. Telegram outage: order flow unaffected, message retried later, sent exactly once
    mode = "fail500";
    const before = received.length;
    await p.goto(`${B}/printing`);
    const doc = await PDFDocument.create(); doc.addPage(); doc.addPage();
    await p.setInputFiles("#print-files", { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
    await fillIfEditable(p, "#pfullName", "Outage Test");
    await fillIfEditable(p, "#pphone", "0911 44 33 22");
    await p.click("aside button[type=submit]");
    await p.waitForURL(/printing\/jobs/);
    check(/PR-\d+/.test(await p.locator("h1").textContent()), "printing request succeeds while Telegram is down");
    // A staff alert (new printing requests no longer alert staff, so use a payment alert) sent while Telegram is down.
    const jobNumber = `ET-9${String(Date.now()).slice(-7)}`;
    sql(`select private.enqueue_notification('new_order', 'e2e-outage-${RUN}', jsonb_build_object('order_number', '${jobNumber}', 'job_number', '${jobNumber}'))`);
    await cron();
    check(await waitFor(() => sql(`select status from notifications_outbox where payload->>'job_number' = '${jobNumber}'`) === "failed"), "failed send recorded for retry");
    check(sql(`select attempts || '|' || (next_attempt_at > now()) || '|' || last_error from notifications_outbox where payload->>'job_number' = '${jobNumber}'`) === "1|true|502 Bad Gateway",
      "attempt counted, retry scheduled in the future, error stored");
    mode = "ok";
    await cron();
    check(sql(`select status from notifications_outbox where payload->>'job_number' = '${jobNumber}'`) === "failed", "not re-sent before its backoff time");
    sql(`update notifications_outbox set next_attempt_at = now() where payload->>'job_number' = '${jobNumber}'`);
    const r = await (await cron()).json();
    check(r.sent >= 1 && sql(`select status from notifications_outbox where payload->>'job_number' = '${jobNumber}'`) === "sent", "cron delivers it once Telegram is back");
    const printMsgs = received.slice(before).filter((x) => x.text?.includes(jobNumber) && x.method === "sendMessage");
    check(printMsgs.length === 2 && printMsgs[1].text.includes("NEW CUSTOMER ORDER"), "exactly one failed + one successful delivery attempt (no duplicates)");

    // ---- 3. Rate limit (429): stop the batch, nothing lost
    sql(`select private.enqueue_notification('test_message', 'e2e-rl-${RUN}-1', '{}'::jsonb); select private.enqueue_notification('test_message', 'e2e-rl-${RUN}-2', '{}'::jsonb);`);
    mode = "rate429once";
    const beforeRl = received.length;
    await cron();
    check(received.length - beforeRl === 1, "after a 429 the rest of the batch is not hammered");
    sql("update notifications_outbox set next_attempt_at = now() where status = 'failed' and event_type = 'test_message'");
    await cron();
    check(sql(`select count(*) from notifications_outbox where event_type = 'test_message' and dedupe_key like 'e2e-rl-${RUN}-%' and status = 'sent'`) === "2", "both messages delivered after the rate limit");

    // ---- 4. Concurrent workers never double-send
    for (let i = 0; i < 6; i++) sql(`select private.enqueue_notification('test_message', 'e2e-cc-${RUN}-${i}', '{}'::jsonb)`);
    const beforeCc = received.length;
    await Promise.all([cron(), cron(), cron()]);
    check(received.length - beforeCc === 6, `3 parallel workers sent 6 queued messages exactly once (${received.length - beforeCc})`);

    // ---- 5. Admin: status, test message, retry
    const a = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await adminLogin(a, B, OWNER.email, OWNER.password);
    await a.goto(`${B}/admin/notifications?tab=telegram`);
    check((await a.locator("text=Connected (TELEGRAM_BOT_TOKEN").count()) === 1, "admin sees Telegram is configured");
    const beforeTest = received.length;
    await a.locator("button:has-text('Send test message')").first().click();
    await a.waitForSelector('[data-sonner-toast]:has-text("Test message sent")');
    check(received.slice(beforeTest).some((x) => x.text?.includes("Test message — orders & payments group")), "test message delivered");
    const deadId = sql(`select id from notifications_outbox where payload->>'job_number' = '${jobNumber}'`);
    sql(`update notifications_outbox set status = 'dead', last_error = '400 Bad Request: chat not found' where id = ${deadId}`);
    await a.goto(`${B}/admin/notifications?tab=messages&cat=payments`);
    await a.locator(`tr:has(td:text-is("${deadId}")) button:has-text("Retry")`).click();
    await a.waitForSelector('[data-sonner-toast]:has-text("re-sent")');
    check(sql(`select status from notifications_outbox where id = ${deadId}`) === "sent", "admin retry re-sends a dead message");

    // ---- 6. Payment decision + cancellation alerts from admin actions
    const subOrder = sql(`select id from orders where order_number = '${orderNumber}'`);
    await a.goto(`${B}/admin/payments`);
    await a.click(`a:has-text("${orderNumber}")`);
    await a.locator("main form:has(button:has-text('Reject')) textarea").fill("Amount not in statement");
    await a.locator("main form:has(button:has-text('Reject')) button").click();
    await a.waitForSelector('[data-sonner-toast]:has-text("Payment rejected")');
    await sleep(2500);
    check(!received.some((x) => x.text?.includes("PAYMENT REJECTED") && x.text.includes(orderNumber)), "no Telegram alert for a rejected payment (payments only: waiting / completed)");
    check(sql(`select status from orders where id = '${subOrder}'`) === "cancelled", "the rejected order was cancelled automatically");
    check(!received.some((x) => x.text?.includes("ORDER CANCELLED") && x.text.includes(orderNumber)), "no Telegram alert for a cancellation");

    // ---- 7. Secrets & auth
    check((await cron(false)).status === 401, "notification cron rejects unauthenticated calls");
    check(sql(`select count(*) from notifications_outbox where last_error like '%${TOKEN.split(":")[1].slice(0, 12)}%'`) === "0", "bot token never stored in the database");
    check(!logs.join("").includes(TOKEN.split(":")[1]), "bot token never written to server logs");
  } finally {
    await b.close();
    try { process.kill(-app.pid, "SIGTERM"); } catch { app.kill("SIGTERM"); }
    mock.close();
  }
  const filtered = results.filter((r) => !r.endsWith("- "));
  console.log(filtered.join("\n"));
  if (filtered.some((r) => r.startsWith("FAIL"))) process.exit(1);
  process.exit(0);
})().catch((e) => {
  console.log(results.join("\n"));
  console.error(e);
  process.exit(1);
});
