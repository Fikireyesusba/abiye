/**
 * Customer Help guide + "order belongs to another account" notice.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/help.smoke.cjs
 */
const { chromium } = require("playwright");
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

    const ord = execSync(`psql -Atq "${DB}" -c "select id from orders where user_id is not null and user_id <> (select id from auth.users where email = 'other-acct@example.com') order by created_at desc limit 1"`).toString().trim();
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
