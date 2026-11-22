/**
 * Customer email notifications end-to-end with a MOCK Resend API.
 * Starts its own app instance (port 3102) pointed at the mock, using the existing production build.
 *   npm run build && NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/emails.smoke.cjs
 * Mutates the LOCAL database only.
 */
const http = require("http");
const { spawn, execSync } = require("child_process");
const { chromium } = require("playwright");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const PORT = 3102;
const B = `http://localhost:${PORT}`;
const MOCK_PORT = 4598;
const KEY = "re_TestKeyForLocalOnly_1234567890";
const FROM = "Abiye <orders@example.com>";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- mock Resend API
const received = [];
let mode = "ok"; // ok | fail500 | reject422
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const entry = { path: req.url, auth: req.headers.authorization, idem: req.headers["idempotency-key"], ...JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") };
    received.push(entry);
    const reply = (status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    if (entry.auth !== `Bearer ${KEY}`) return reply(401, { message: "API key is invalid" });
    if (mode === "fail500") return reply(500, { message: "internal" });
    if (mode === "reject422") return reply(422, { message: "Invalid `to` field" });
    return reply(200, { id: `email_${received.length}` });
  });
});
const mails = (to, part) => received.filter((m) => m.to?.[0] === to && (!part || m.subject.includes(part)));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}
const cron = () => fetch(`${B}/api/cron/notifications`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) => r.json());
const asManager = (q) => {
  const id = sql("select p.id from profiles p join admin_roles r on r.id = p.role_id where r.key = 'super_admin' and p.is_active limit 1");
  return sql(`begin; select set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated","aal":"aal2"}', true); set local role authenticated; ${q}; commit;`);
};

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  // Earlier local runs left unsent rows (email was not configured): park them.
  sql("update notifications_outbox set status = 'dead', last_error = 'e2e reset' where status in ('pending','failed','processing'); delete from rate_limits;");
  sql("update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, RESEND_API_KEY: KEY, EMAIL_FROM: FROM, EMAIL_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, APP_URL: B, TELEGRAM_BOT_TOKEN: "", TELEGRAM_ADMIN_CHAT_ID: "" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const logs = [];
  app.stdout.on("data", (d) => logs.push(d.toString()));
  app.stderr.on("data", (d) => logs.push(d.toString()));
  const b = await chromium.launch();
  try {
    if (!(await waitFor(async () => (await fetch(B).catch(() => null))?.ok ?? false, 30000))) throw new Error("app did not start");
    const email = `emails-${RUN}@example.com`;
    await ensureCustomer(email, "EmailsE2E2026");
    const p = await (await b.newContext()).newPage();
    await loginCustomer(p, B, email, "EmailsE2E2026");

    // ---- 1. Order placed → "how to pay" email, immediately
    await p.goto(B);
    await p.evaluate(() => {
      localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: "20000000-0000-0000-0000-000000000007", quantity: 1 }]));
      localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "pickup", deliveryZoneId: null }));
    });
    await p.goto(`${B}/checkout`);
    await p.waitForSelector("text=Order summary");
    await p.fill("#fullName", "Email Customer");
    await p.fill("#phone", "0911 22 66 77");
    await p.check("label:has-text('I agree') input[type=checkbox]");
    await p.click("button:has-text('Place order')");
    await p.waitForURL(/order-success/);
    let orderId = p.url().split("/order-success/")[1].split("?")[0];
    const number = sql(`select order_number from orders where id = '${orderId}'`);
    check(await waitFor(() => mails(email, number).length === 1), "order placed: email sent right away");
    const placed = mails(email, number)[0];
    check(placed?.from === FROM && placed?.idem?.startsWith("outbox-"), "sent from the configured address, with an idempotency key");
    check(placed?.html.includes(`/order-success/${orderId}`) && placed?.html.includes("lang=\"am\"") && /CBE|Bank|ባንክ/.test(placed?.html ?? ""),
      "contains the order link, bank details and Amharic");

    // ---- 1b. The email link opened in a signed-out browser (e.g. Gmail's in-app browser)
    const link = placed.html.match(/href="([^"]*\/order-success\/[^"]+)"/)[1];
    const fresh = await (await b.newContext()).newPage();
    await fresh.goto(link);
    check(new URL(fresh.url()).pathname === "/account/login", "email link in a signed-out browser asks to sign in");
    await fresh.fill("#email", email);
    await fresh.fill("#password", "EmailsE2E2026");
    await fresh.click("form button[type=submit]");
    await fresh.waitForURL((u) => u.pathname === `/order-success/${orderId}`, { timeout: 15000 });
    check(await fresh.locator("#receipt").count() === 1, "after signing in the customer lands on the order with the receipt upload");

    // ---- 2. Payment rejected (with reason) then verified, via the admin UI
    const submit = (n) => sql(`set role service_role; select public.submit_payment(jsonb_build_object('order_id','${orderId}','access_token_hash','${sql(`select access_token_hash from orders where id = '${orderId}'`)}',
      'receipt',jsonb_build_object('path','orders/${orderId}/r${n}.png','mime','image/png','size',100,'sha256',encode(sha256('${RUN}${n}'::bytea),'hex'))))`);
    submit(1);
    const a = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    a.on("dialog", (d) => d.accept());
    await adminLogin(a, B, OWNER.email, OWNER.password);
    await a.goto(`${B}/admin/orders/${orderId}`);
    await a.fill("textarea[aria-label='Rejection reason']", "Amount not in our bank statement");
    await a.click("button:has-text('Reject')");
    await a.waitForSelector("[data-sonner-toast]");
    check(await waitFor(() => mails(email, "Payment not verified").length === 1), "payment rejected: email sent (order cancelled)");
    check(mails(email, "Payment not verified")[0]?.html.includes("Amount not in our bank statement"), "rejection email includes the reason");
    await sleep(1500);
    check(mails(email, "was cancelled").length === 0 && sql(`select status from orders where id = '${orderId}'`) === "cancelled", "order cancelled automatically, no second email");
    // A new order for the rest of the steps.
    await fresh.evaluate(() => {
      localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: "20000000-0000-0000-0000-000000000007", quantity: 1 }]));
      localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "pickup", deliveryZoneId: null }));
    });
    await fresh.goto(`${B}/checkout`);
    await fresh.waitForSelector("text=Order summary");
    await fresh.check("label:has-text('I agree') input[type=checkbox]");
    await fresh.click("button:has-text('Place order')");
    await fresh.waitForURL(/order-success/);
    orderId = fresh.url().split("/order-success/")[1].split("?")[0];
    submit(2);
    await a.goto(`${B}/admin/orders/${orderId}`);
    await a.click("button:has-text('Verify payment')");
    await a.waitForSelector("[data-sonner-toast]");
    check(await waitFor(() => mails(email, "confirmed").length === 1), "payment verified: confirmation email");

    // ---- 3. Temporary failure is retried; permanent failure gives up
    mode = "fail500";
    asManager(`select public.admin_update_order_status('${orderId}', 'processing'); select public.admin_update_order_status('${orderId}', 'ready_for_pickup')`);
    await cron();
    check(sql(`select status || ':' || attempts from notifications_outbox where channel = 'email' and event_type = 'customer_order_ready_for_pickup' and payload->>'order_id' = '${orderId}'`) === "failed:1",
      "provider error: email kept for retry");
    mode = "ok";
    sql("update notifications_outbox set next_attempt_at = now() where channel = 'email' and status = 'failed'");
    await cron();
    const tries = mails(email, "ready for pickup");
    check(tries.length === 2 && tries[0].idem === tries[1].idem && sql(`select status from notifications_outbox where channel = 'email' and event_type = 'customer_order_ready_for_pickup' and payload->>'order_id' = '${orderId}'`) === "sent",
      "retry delivers the email (same idempotency key, so the provider never sends it twice)");
    check(mails(email, "processing").length === 0, "internal steps send no email");
    mode = "reject422";
    asManager(`select public.admin_update_order_status('${orderId}', 'completed')`);
    await cron();
    check(sql(`select status from notifications_outbox where channel = 'email' and event_type = 'customer_order_completed' and payload->>'order_id' = '${orderId}'`) === "dead",
      "rejected by the provider: not retried");
    mode = "ok";

    // ---- 4. Old queued emails are dropped, not sent late
    sql(`insert into notifications_outbox (channel, event_type, dedupe_key, payload, recipient_user_id, created_at)
         values ('email', 'customer_order_confirmed', 'e2e-old-${RUN}', '{"order_number":"ET-OLD"}', (select id from auth.users where email = '${email}'), now() - interval '3 days')`);
    await cron();
    check(mails(email, "ET-OLD").length === 0 && sql(`select status from notifications_outbox where dedupe_key = 'e2e-old-${RUN}'`) === "dead", "emails older than 2 days are not sent");
    check(received.every((m) => m.to?.length === 1), "one recipient per email (no other customers copied)");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
    console.log(logs.slice(-20).join(""));
  } finally {
    await b.close();
    try { process.kill(-app.pid, "SIGTERM"); } catch { app.kill("SIGTERM"); }
    mock.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
