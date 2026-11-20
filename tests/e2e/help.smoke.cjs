/**
 * Customer Help guide + "order belongs to another account" notice.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/help.smoke.cjs
 */
const { chromium } = require("playwright");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);

(async () => {
  const b = await chromium.launch();
  try {
    const d = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await d.goto(`${B}/help`);
    check(await d.locator("main section[id]").count() >= 10, "help guide has all sections");
    check(await d.locator("header a[href='/help']").count() === 1 && await d.locator("footer a[href='/help']").count() === 1, "linked from header and footer");
    const txt = await d.locator("main").innerText();
    check(!/\{\w+\}/.test(txt) && /\d+ hours/.test(txt), "settings values filled in (payment window, file limits)");
    await d.click("nav a[href='#paying']");
    check(d.url().endsWith("#paying"), "contents link jumps to the section");
    await d.click("details summary >> nth=0");
    check(await d.locator("details[open]").count() === 1, "FAQ answers expand");

    const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
    await m.context().addCookies([{ name: "NEXT_LOCALE", value: "am", url: B }]);
    await m.goto(`${B}/help`);
    check((await m.locator("h1").innerText()).includes("እርዳታ"), "Amharic guide");
    check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no horizontal overflow on phones");

    // An order placed by a different customer (created here, so the test never depends on leftover data).
    const ownerId = await ensureCustomer("help-order-owner@example.com", "HelpOwner2026x");
    const key = crypto.randomUUID();
    execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: `set role service_role; select public.create_order_for_user('${ownerId}', jsonb_build_object('idempotency_key','${key}',
      'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
      'customer',jsonb_build_object('full_name','Help Owner','phone','+251911223394'),'fulfillment',jsonb_build_object('method','pickup'),
      'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))` });
    const ord = execSync(`psql -Atq "${DB}" -c "select id from orders where idempotency_key = '${key}'"`).toString().trim();
    await ensureCustomer("other-acct@example.com", "OtherAcct2026");
    const o = await (await b.newContext()).newPage();
    await loginCustomer(o, B, "other-acct@example.com", "OtherAcct2026");
    await o.goto(`${B}/order-success/${ord}`);
    check(await o.locator("text=different account").count() === 1, "someone else's order: explains it belongs to another account");
    await o.click("button:has-text('Sign in with another account')");
    await o.waitForURL(/\/account\/login/);
    check(decodeURIComponent(o.url()).includes(`/order-success/${ord}`), "switching account returns to the order after sign-in");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
