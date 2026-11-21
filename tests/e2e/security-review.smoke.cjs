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
  sql(`insert into security_reviews (subject_type, subject) select 'customer', id::text from auth.users
       on conflict (subject_type, subject) do update set reviewed_at = now()`);
  sql(`insert into security_events (kind, email, ip_hash, created_at) select 'admin_login_failed', e, md5(e || g), now() - interval '10 minutes'
       from (values ('${A}'), ('${B2}')) v(e), generate_series(1, 3) g`);
  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/security?tab=emails`);
    check(await badge(o) === "2", `red badge shows 2 active alerts (${await badge(o)})`);
    const row = o.locator("tr", { hasText: A });
    await row.locator("button:has-text('Mark as reviewed')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('1 alert cleared')");
    await o.reload();
    check(await o.locator("tr", { hasText: A }).count() === 0, "reviewed email leaves the list");
    check(await badge(o) === "1", `badge drops to 1 (${await badge(o)})`);
    check((await o.locator("main").innerText()).includes(A) && (await o.locator("main").innerText()).includes("Recently reviewed"), "shown under Recently reviewed");

    // no bulk clearing: each alert is reviewed on its own
    check(await o.locator("button:has-text('Mark all')").count() === 0, "no 'Mark all as reviewed' button");
    await o.locator("tr", { hasText: B2 }).locator("button:has-text('Mark as reviewed')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('1 alert cleared')");
    await o.reload();
    check(await badge(o) === "", `badge gone (${await badge(o) || "none"})`);
    await o.goto(`${B}/admin/security?tab=overview`);
    check((await o.locator("main").innerText()).includes("all reviewed"), "health & stats card says all reviewed");

    // new activity brings it back
    sql(`insert into security_events (kind, email, ip_hash) select 'admin_mfa_failed', '${A}', md5('n' || g) from generate_series(1, 2) g`);
    await o.goto(`${B}/admin/security?tab=emails`);
    check(await o.locator("tr", { hasText: A }).count() === 1, "new attempts after the review show again");
    check(sql(`select count(*) from security_events where email = '${A}'`) === "5", "event history kept");
    check(sql("select count(*) from audit_logs where action = 'security_reviewed' and created_at > now() - interval '5 minutes'") >= "2", "clearing recorded in the Activity log");

    // ---- Active alerts dashboard (default tab)
    await o.goto(`${B}/admin/security`);
    const card = o.locator("li[data-alert=email]", { hasText: A });
    check(await card.count() === 1, "dashboard opens on active alerts with the new alert");
    check((await card.innerText()).includes("wrong two-step code"), "alert explains what happened");
    await card.locator("input[name=reason]").fill("Repeated attacks");
    await card.locator("button:has-text('Block')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Blocked')");
    await o.reload();
    check(await o.locator("li[data-alert=email]", { hasText: A }).count() === 0, "blocked alert leaves the dashboard");
    // a suspicious customer: several expired unpaid orders
    const cEmail = `sus-${RUN}@example.com`;
    const cid = await require("./_customer.cjs").ensureCustomer(cEmail, "SusE2E2026x");
    for (let i = 0; i < 3; i++) {
      const key = sql("select gen_random_uuid()");
      sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key','${key}',
        'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
        'customer',jsonb_build_object('full_name','Sus Buyer','phone','+251911223392'),'fulfillment',jsonb_build_object('method','pickup'),
        'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
    }
    sql(`update orders set status = 'expired' where user_id = '${cid}'`);
    await o.reload();
    const cc = o.locator("li[data-alert=customer]", { hasText: cEmail });
    check(await cc.count() === 1 && (await cc.innerText()).includes("Many orders placed but never paid"), "suspicious customer alert with the reason");
    check(await badge(o) === "1", `badge counts the active alert (${await badge(o)})`);
    await cc.locator("input[name=note]").fill("Called the customer, genuine");
    await cc.locator("button:has-text('Mark as reviewed')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('1 alert cleared')");
    await o.reload();
    check(await o.locator("[data-alert]").count() === 0 && (await o.locator("main").innerText()).includes("No active alerts"), "dashboard empty once everything is actioned");
    check(await badge(o) === "", "badge cleared");
    check((await o.locator("main").innerText()).includes("Called the customer, genuine"), "review note kept under Recently reviewed");
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
