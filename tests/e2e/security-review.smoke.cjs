/**
 * Clearing security alerts: "Mark as reviewed" removes an email from the list and the red badge until new activity.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/security-review.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const A = `attacker-${RUN}@example.com`;
const B2 = `typo-${RUN}@example.com`;
const badge = async (p) => (await p.locator("nav a[href='/admin/security']").first().innerText()).replace(/\D+/g, " ").trim();

(async () => {
  sql("delete from rate_limits");
  // Clear older open alerts so the badge counts only this test's emails.
  sql(`insert into security_reviews (subject_type, subject) select distinct 'email', lower(email) from security_events where email is not null
       on conflict (subject_type, subject) do update set reviewed_at = now()`);
  sql(`insert into security_events (kind, email, ip_hash, created_at) select 'admin_login_failed', e, md5(e || g), now() - interval '10 minutes'
       from (values ('${A}'), ('${B2}')) v(e), generate_series(1, 3) g`);
  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/security?tab=emails`);
    check(await badge(o) === "2", `red badge shows 2 high-risk emails (${await badge(o)})`);
    const row = o.locator("tr", { hasText: A });
    await row.locator("button:has-text('Mark as reviewed')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('1 alert cleared')");
    await o.reload();
    check(await o.locator("tr", { hasText: A }).count() === 0, "reviewed email leaves the list");
    check(await badge(o) === "1", `badge drops to 1 (${await badge(o)})`);
    check((await o.locator("main").innerText()).includes(A) && (await o.locator("main").innerText()).includes("Recently reviewed"), "shown under Recently reviewed");

    // mark all
    await o.click("button:has-text('Mark all 1 as reviewed')");
    await o.waitForSelector("[data-sonner-toast]:has-text('cleared')");
    await o.reload();
    check(await badge(o) === "", `badge gone (${await badge(o) || "none"})`);
    await o.goto(`${B}/admin/security`);
    check((await o.locator("main").innerText()).includes("all reviewed"), "overview card says all reviewed");

    // new activity brings it back
    sql(`insert into security_events (kind, email, ip_hash) select 'admin_mfa_failed', '${A}', md5('n' || g) from generate_series(1, 2) g`);
    await o.goto(`${B}/admin/security?tab=emails`);
    check(await o.locator("tr", { hasText: A }).count() === 1, "new attempts after the review show again");
    check(sql(`select count(*) from security_events where email = '${A}'`) === "5", "event history kept");
    check(sql("select count(*) from audit_logs where action = 'security_reviewed' and created_at > now() - interval '5 minutes'") >= "2", "clearing recorded in the Activity log");
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
