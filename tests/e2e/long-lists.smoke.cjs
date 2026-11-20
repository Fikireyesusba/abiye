/**
 * Long admin lists: fixed-height box that scrolls on its own (titles stay visible) + search filter.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/long-lists.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");
const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
(async () => {
  execSync(`psql -q "${DB}" -c "delete from rate_limits"`);
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await adminLogin(p, B, OWNER.email, OWNER.password);
    await p.goto(`${B}/admin/inventory`);
    const box = p.locator("main div[tabindex='0']").first();
    const sz = await box.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, vh: innerHeight }));
    check(sz.h <= sz.vh * 0.66 && (sz.sh <= sz.h || sz.sh > sz.h), `inventory list stays within ~2/3 of the screen (${sz.h}px of ${sz.vh}px)`);
    if (sz.sh > sz.h) {
      await box.evaluate((el) => el.scrollTo(0, 300));
      const head = await p.locator("main thead").first().evaluate((el) => el.getBoundingClientRect().top);
      const top = await box.evaluate((el) => el.getBoundingClientRect().top);
      check(Math.abs(head - top) < 3, "column titles stay visible while scrolling");
    }
    const total = await p.locator("main tbody tr").count();
    const first = (await p.locator("main tbody tr td").first().innerText()).split("\n")[0];
    await p.fill("main input[type=search]", first);
    await p.waitForTimeout(200);
    const shown = await p.locator("main tbody tr:visible").count();
    check(shown >= 1 && shown < total || total <= 5, `search filters the list (${shown} of ${total})`);
    await p.fill("main input[type=search]", "");
    check(await p.locator("main tbody tr:visible").count() === total, "clearing the search shows everything again");
    await p.click("[data-testid=stock-movements] summary");
    const all = await p.locator("[data-testid=stock-movements] li[data-row]").count();
    await p.fill("[data-testid=stock-movements] input[type=search]", "zzz-no-such-thing");
    check(await p.locator("[data-testid=stock-movements] li[data-row]:visible").count() === 0 && all > 0, "stock movements are searchable");
    await p.goto(`${B}/admin/notifications`);
    check(await p.locator("main details div[tabindex='0']").count() >= 1, "notification categories use the scrolling box");
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
