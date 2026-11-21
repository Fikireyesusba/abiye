/**
 * Personal discount codes sent to the customer: "Create & send" on the customer page, notify on/off,
 * customer sees it in My account. Own app on :3106 with a MOCK Resend.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/promo-send.smoke.cjs
 */
const http = require("http");
const { spawn, execSync } = require("child_process");
const { chromium } = require("playwright");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const PORT = 3106;
const B = `http://localhost:${PORT}`;
const MAIL_PORT = 4595;
const KEY = "re_TestKeyForLocalOnly_1234567890";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = [];
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => { mails.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); res.writeHead(200, { "content-type": "application/json" }); res.end('{"id":"x"}'); });
});
async function waitFor(fn, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(300); } return false; }
const to = (email) => mails.filter((m) => m.to?.[0] === email);

(async () => {
  await new Promise((r) => mock.listen(MAIL_PORT, "127.0.0.1", r));
  sql("update notifications_outbox set status = 'dead', last_error = 'e2e reset' where status in ('pending','failed','processing'); delete from rate_limits;");
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, RESEND_API_KEY: KEY, EMAIL_FROM: "Abiye <orders@example.com>", EMAIL_API_BASE: `http://127.0.0.1:${MAIL_PORT}`, APP_URL: B, TELEGRAM_BOT_TOKEN: "", TELEGRAM_ADMIN_CHAT_ID: "" },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const logs = [];
  app.stdout.on("data", (d) => logs.push(d.toString()));
  app.stderr.on("data", (d) => logs.push(d.toString()));
  const b = await chromium.launch();
  try {
    if (!(await waitFor(async () => (await fetch(B).catch(() => null))?.ok ?? false, 30000))) throw new Error("app did not start");
    const email = `gift-${RUN}@example.com`;
    const uid = await ensureCustomer(email, "GiftE2E2026x");
    sql(`update customer_accounts set full_name = 'Selam Bekele' where id = '${uid}'`);
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/customers/${uid}?tab=promos`);
    const form = o.locator("form:has(input[name=days])");
    await form.locator("input[name=value]").fill("150");
    await form.locator("select[name=discountType]").selectOption("fixed");
    await form.locator("input[name=minOrder]").fill("1000");
    await form.locator("input[name=days]").fill("14");
    await o.locator("form:has(input[name=days]) input[name=note]").fill("Thank you for shopping with us!");
    await form.locator("button:has-text('Create & send')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('created and given')");
    const code = sql(`select p.code from promotions p join promotion_customers c on c.promotion_id = p.id where c.user_id = '${uid}' order by p.created_at desc limit 1`);
    check(/^SELAM-[A-HJ-NP-Z2-9]{4}$/.test(code), `unique code created (${code})`);
    check(await waitFor(() => to(email).some((m) => m.subject?.includes(code))), "email with the code arrives right away");
    const m = to(email).find((x) => x.subject?.includes(code));
    check(m && m.html.includes("Thank you for shopping with us!") && m.html.includes("150") && m.html.includes("1,000"), "email has the note, discount and minimum order");
    check((await o.locator("main").innerText()).includes(code), "code listed on the customer page");

    // customer sees it
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "GiftE2E2026x");
    await c.goto(`${B}/account`);
    await c.click("[data-testid=account-menu] a[href='/account/offers']");
    await c.waitForURL(/\/account\/offers$/);
    check((await c.locator("#offers").innerText()).includes(code), "customer sees it under My offers (from the My account menu)");

    // existing personal promotion, notify OFF → no email
    sql(`insert into promotions (title_en, title_am, code, discount_type, discount_value, restricted, is_active) values ('Quiet ${RUN}', 'ጸጥ', 'QUIET${RUN.toUpperCase()}', 'percent', 5, true, true)`);
    await o.reload();
    const give = o.locator("form:has(select[name=promotionId])");
    await give.locator("select[name=promotionId]").selectOption({ label: `QUIET${RUN.toUpperCase()} — Quiet ${RUN}` });
    await give.locator("input[name=notify]").uncheck();
    const before = to(email).length;
    await give.locator("button:has-text('Give code')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Given to 1 customer')");
    await sleep(2500);
    check(to(email).length === before, "no email when 'send it' is unticked");
    check(sql(`select count(*) from promotion_customers pc join promotions p on p.id = pc.promotion_id where p.code = 'QUIET${RUN.toUpperCase()}' and pc.user_id = '${uid}'`) === "1", "but the code is given");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
    console.log(logs.join("").slice(-1500));
  } finally {
    await b.close();
    try { process.kill(-app.pid, "SIGTERM"); } catch {}
    mock.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
