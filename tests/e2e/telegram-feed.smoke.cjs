/**
 * Telegram activity feed with MOCK Telegram + MOCK Resend: security events, high-risk alert,
 * admin actions, copies of customer notifications, switches. Own app on port 3105.
 *   npm run build && NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/telegram-feed.smoke.cjs
 */
const http = require("http");
const { spawn, execSync } = require("child_process");
const { chromium } = require("playwright");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer } = require("./_customer.cjs");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const PORT = 3105;
const B = `http://localhost:${PORT}`;
const TG_PORT = 4597;
const MAIL_PORT = 4596;
const TOKEN = "7000000001:AAFakeTokenForLocalTestsOnly_abcdefghijk";
const KEY = "re_TestKeyForLocalOnly_1234567890";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tg = [];
const tgServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const text = req.headers["content-type"]?.startsWith("application/json") ? JSON.parse(body).text : body.match(/name="caption"\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
    tg.push(text ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { message_id: tg.length } }));
  });
});
const mailServer = http.createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"id":"x"}'); });
});
const has = (...parts) => tg.some((t) => parts.every((p) => t.includes(p)));
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(300); }
  return false;
}
const cron = () => fetch(`${B}/api/cron/notifications`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

(async () => {
  await new Promise((r) => tgServer.listen(TG_PORT, "127.0.0.1", r));
  await new Promise((r) => mailServer.listen(MAIL_PORT, "127.0.0.1", r));
  sql("update notifications_outbox set status = 'dead', last_error = 'e2e reset' where status in ('pending','failed','processing'); delete from rate_limits; delete from website_settings where key = 'telegram_feed';");
  sql("update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_ADMIN_CHAT_ID: "-100123", TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`,
           RESEND_API_KEY: KEY, EMAIL_FROM: "Abiye <orders@example.com>", EMAIL_API_BASE: `http://127.0.0.1:${MAIL_PORT}`, APP_URL: B },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const logs = [];
  app.stdout.on("data", (d) => logs.push(d.toString()));
  app.stderr.on("data", (d) => logs.push(d.toString()));
  const b = await chromium.launch();
  try {
    if (!(await waitFor(async () => (await fetch(B).catch(() => null))?.ok ?? false, 30000))) throw new Error("app did not start");
    const INTRUDER = `intruder-${RUN}@example.com`;

    // ---- security events: wrong admin password (from two networks → also a high-risk alert)
    for (const ip of ["198.51.100.7", "203.0.113.9"]) {
      const p = await (await b.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } })).newPage();
      await p.goto(`${B}/admin/login`);
      await p.fill("#email", INTRUDER);
      await p.fill("#password", "wrong-password-123");
      await p.click("button[type=submit]");
      await p.waitForSelector("[role=alert]");
    }
    check(await waitFor(() => has("SECURITY: NON-STAFF ACCOUNT TRIED THE ADMIN PANEL", INTRUDER) || has("SECURITY: WRONG PASSWORD", INTRUDER)),
      "failed admin sign-in reported to Telegram");
    check(has("Service: Admin sign-in", INTRUDER), "with service and event name");
    check(await waitFor(() => has("SECURITY ALERT: HIGH-RISK EMAIL", INTRUDER)), "🚨 high-risk alert");

    // ---- successful admin sign-in
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    check(await waitFor(() => has("SECURITY: SIGNED IN", OWNER.email)), "admin sign-in reported");

    // ---- admin action: block an email
    await o.goto(`${B}/admin/security?tab=blocked`);
    await o.fill("input[name=email]", INTRUDER);
    await o.fill("input[name=reason]", "Tried the admin panel");
    await o.click("form button:has-text('Block')");
    check(await waitFor(() => has("ADMIN ACTION: EMAIL BLOCKED", "Tried the admin panel")), "blocking reported with who and why");
    check(has("Service: Security · Event: Email blocked"), "admin action service/event");

    // ---- copy of a customer notification
    const cid = await ensureCustomer(`feed-${RUN}@example.com`, "FeedE2E2026x");
    const key = sql("select gen_random_uuid()");
    sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key','${key}',
      'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
      'customer',jsonb_build_object('full_name','Feed Buyer','phone','+251911223393'),'fulfillment',jsonb_build_object('method','pickup'),
      'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
    const num = sql(`select order_number from orders where idempotency_key = '${key}'`);
    await cron();
    await cron();
    check(await waitFor(() => has("SENT: ORDER PLACED (HOW TO PAY)", num, `feed-${RUN}@example.com`)), "copy of the customer's email in Telegram");
    check(has("Service: Customer email · Event: Order placed (how to pay)"), "notification copy service/event");

    // ---- switches: security off → no more security messages
    await o.goto(`${B}/admin/notifications`);
    await o.uncheck("input[name=security]");
    await o.click("form:has(input[name=security]) button[type=submit]");
    await o.waitForSelector("[data-sonner-toast]:has-text('Telegram activity feed saved')");
    const before = tg.length;
    const q = await (await b.newContext({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.55" } })).newPage();
    await q.goto(`${B}/admin/login`);
    await q.fill("#email", `quiet-${RUN}@example.com`);
    await q.fill("#password", "wrong-password-123");
    await q.click("button[type=submit]");
    await q.waitForSelector("[role=alert]");
    await sleep(2500);
    check(!tg.slice(before).some((t) => t.includes(`quiet-${RUN}@example.com`)), "no security messages when switched off");
    check(tg.every((t) => /Service: .+ · Event: .+/.test(t)), `every message has service + event (${tg.length} messages)`);
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
    console.log(logs.join("").slice(-1500));
  } finally {
    await b.close();
    sql(`delete from website_settings where key = 'telegram_feed'; delete from blocked_emails where email like 'intruder-%@example.com';`);
    try { process.kill(-app.pid, "SIGTERM"); } catch {}
    tgServer.close();
    mailServer.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
