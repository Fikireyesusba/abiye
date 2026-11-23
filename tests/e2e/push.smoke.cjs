/**
 * Customer phone notifications (Web Push) end-to-end.
 * Starts its own app (port 3103) with test VAPID keys and a MOCK push service.
 * The test plays the phone: it owns the device keys and DECRYPTS what the
 * server sends (RFC 8291 aes128gcm), so the real encryption is verified.
 *   npm run build && NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/push.smoke.cjs
 */
const crypto = require("crypto");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { chromium } = require("playwright");
const webpush = require("web-push");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const PORT = 3103;
const B = `http://localhost:${PORT}`;
const MOCK_PORT = 4597;
const VAPID = webpush.generateVAPIDKeys();
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString("base64url");

// ---------------------------------------------------------------- the "phone": device keys + decryption
const device = crypto.createECDH("prime256v1");
device.generateKeys();
const authSecret = crypto.randomBytes(16);
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const shared = device.computeSecret(serverPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from("WebPush: info\0"), device.getPublicKey(), serverPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString("utf8"));
}

// ---------------------------------------------------------------- mock push service
const received = [];
const gone = new Set();
// Self-signed certificate for the local mock (the push library only speaks HTTPS).
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-mock-"));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=127.0.0.1 -keyout ${certDir}/key.pem -out ${certDir}/cert.pem`, { stdio: "ignore" });
const mock = https.createServer({ key: fs.readFileSync(`${certDir}/key.pem`), cert: fs.readFileSync(`${certDir}/cert.pem`) }, (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const entry = { path: req.url, headers: req.headers, body: Buffer.concat(chunks) };
    received.push(entry);
    if (gone.has(req.url)) { res.writeHead(410); return res.end(); }
    res.writeHead(201); res.end();
  });
});
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  sql("update notifications_outbox set status = 'dead', last_error = 'e2e reset' where status in ('pending','failed','processing'); delete from rate_limits;");
  sql("update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, APP_URL: B, VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: "mailto:test@example.com",
      PUSH_TEST_ENDPOINT_BASE: `https://127.0.0.1:${MOCK_PORT}`, TELEGRAM_BOT_TOKEN: "", RESEND_API_KEY: "",
      // Test app instance only: trust the mock's self-signed certificate.
      NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const logs = [];
  app.stdout.on("data", (d) => logs.push(d.toString()));
  app.stderr.on("data", (d) => logs.push(d.toString()));
  // Full Chromium (not the headless shell): the shell always reports notifications as blocked.
  const b = await chromium.launch({ channel: "chromium" });
  try {
    if (!(await waitFor(async () => (await fetch(B).catch(() => null))?.ok ?? false, 30000))) throw new Error("app did not start");
    const email = `push-${RUN}@example.com`;
    const userId = await ensureCustomer(email, "PushE2E2026x");
    const ENDPOINT = `https://fcm.googleapis.com/fcm/send/e2e-${RUN}`;

    // The browser's push service is not reachable from the test sandbox: stand in for it with
    // a subscription that carries the test device's real keys (everything after this is real).
    const ctx = await b.newContext();
    await ctx.grantPermissions(["notifications"], { origin: B });
    await ctx.addInitScript(({ endpoint, p256dh, auth }) => {
      // The browser remembers the subscription across page loads (like a real one).
      const fake = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth } }), unsubscribe: async () => (localStorage.removeItem("e2e-push"), true) };
      const patch = (reg) => {
        reg.pushManager.subscribe = async () => (localStorage.setItem("e2e-push", "1"), fake);
        reg.pushManager.getSubscription = async () => (localStorage.getItem("e2e-push") ? fake : null);
      };
      if (navigator.serviceWorker) {
        const ready = Object.getOwnPropertyDescriptor(ServiceWorkerContainer.prototype, "ready").get;
        Object.defineProperty(navigator.serviceWorker, "ready", { get() { return ready.call(this).then((r) => (patch(r), r)); } });
        const getReg = navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker);
        navigator.serviceWorker.getRegistration = async (...a) => { const r = await getReg(...a); if (r) patch(r); return r; };
      }
    }, { endpoint: ENDPOINT, p256dh: b64u(device.getPublicKey()), auth: b64u(authSecret) });
    const p = await ctx.newPage();
    await loginCustomer(p, B, email, "PushE2E2026x");
    await p.goto(`${B}/account/notifications`);
    await p.waitForSelector("button:has-text('Turn on notifications')");
    check(true, "My account offers phone notifications");
    await p.click("button:has-text('Turn on notifications')");
    await p.waitForSelector("text=Notifications are on for this device");
    check(sql(`select count(*) from push_subscriptions where user_id = '${userId}' and endpoint = '${ENDPOINT}' and locale = 'en'`) === "1", "device saved for this customer");

    // ---- payment accepted (the order now exists) → encrypted notification to the device
    const key = sql("select gen_random_uuid()");
    sql(`set role service_role; select public.create_order_for_user('${userId}', jsonb_build_object('idempotency_key','${key}',
      'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
      'customer',jsonb_build_object('full_name','Push Customer','phone','+251911223388'),'fulfillment',jsonb_build_object('method','pickup'),
      'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
    const orderId = sql(`select id from orders where idempotency_key = '${key}'`);
    const number = sql(`select order_number from orders where id = '${orderId}'`);
    sql(`update orders set status = 'confirmed', payment_status = 'verified', payment_verified_at = now() where id = '${orderId}'`);
    await fetch(`${B}/api/cron/notifications`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    check(await waitFor(() => received.some((r) => r.path.endsWith(`e2e-${RUN}`))), "notification sent to the device's push service");
    const msg = received.find((r) => r.path.endsWith(`e2e-${RUN}`));
    check(msg.headers["content-encoding"] === "aes128gcm" && /^vapid t=.+, k=/.test(msg.headers.authorization ?? "") && Number(msg.headers.ttl) > 0,
      "sent encrypted with VAPID authentication");
    const note = decrypt(msg.body);
    check(note.title === "Payment received ✓" && note.body.includes(number) && note.url === `/order-success/${orderId}`, `device decrypts: "${note.title}" — ${note.body}`);

    // ---- in the browser: the app's service worker shows it and opens the order on tap
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("ServiceWorker.enable");
    const regId = await new Promise((resolve) => {
      cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => { const r = e.registrations.find((x) => x.scopeURL.startsWith(B)); if (r) resolve(r.registrationId); });
      setTimeout(() => resolve(null), 5000);
    });
    if (regId) {
      await cdp.send("ServiceWorker.deliverPushMessage", { origin: B, registrationId: regId, data: JSON.stringify(note) });
      const shown = await waitFor(async () => (await p.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map((n) => n.title))).length > 0, 5000);
      const titles = await p.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map((n) => n.title));
      check(shown && titles.includes(note.title), "the app shows the notification on the phone");
    } else check(false, "service worker registration found");

    // ---- Amharic device; a removed device is forgotten
    sql(`update push_subscriptions set locale = 'am' where endpoint = '${ENDPOINT}'`);
    const OLD = `https://fcm.googleapis.com/fcm/send/old-${RUN}`;
    sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('${userId}', '${OLD}', '${b64u(device.getPublicKey())}', '${b64u(authSecret)}')`);
    gone.add(`/fcm/send/old-${RUN}`);
    const sid = sql("select id from payment_submissions limit 0");
    void sid;
    sql(`update orders set status = 'cancelled', cancelled_at = now() where id = '${orderId}'`);
    await fetch(`${B}/api/cron/notifications`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const am = received.filter((r) => r.path.endsWith(`e2e-${RUN}`)).map((r) => decrypt(r.body)).find((n) => n.title.includes("ተሰርዟል"));
    check(!!am && am.title === `ትዕዛዝ ${number} ተሰርዟል`, `Amharic device gets Amharic text ("${am?.title}")`);
    check(sql(`select count(*) from push_subscriptions where endpoint = '${OLD}'`) === "0", "a device that uninstalled (410) is removed");

    // ---- turn off
    await p.goto(`${B}/account/notifications`);
    await p.click("button:has-text('Turn off')");
    await p.waitForSelector("button:has-text('Turn on notifications')");
    check(sql(`select count(*) from push_subscriptions where user_id = '${userId}'`) === "0", "turning off removes the device");

    // ---- iPhone in Safari (not installed): guided to install first
    const { devices } = require("playwright");
    const ip = await (await b.newContext({ ...devices["iPhone 14"] })).newPage();
    await loginCustomer(ip, B, email, "PushE2E2026x");
    await ip.goto(`${B}/account/notifications`);
    await ip.waitForSelector("text=notifications work in the installed app", { timeout: 10000 }).catch(() => null);
    check(await ip.locator("text=notifications work in the installed app").count() === 1, "iPhone (browser): explains to install the app first");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
    console.log(logs.slice(-15).join(""));
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
