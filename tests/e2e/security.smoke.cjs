/**
 * Security monitoring: failed sign-ins recorded with the email used, block /
 * unblock emails everywhere, suspicious customers, admin sign-ins, site health.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/security.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });

(async () => {
  sql("delete from rate_limits");
  const attacker = `attacker-${RUN}@evil.test`;
  const cust = `sec-cust-${RUN}@example.com`;
  const cid = await ensureCustomer(cust, "SecCust2026x");
  const mEmail = `sec-mgr-${RUN}@example.com`;
  const mid = await ensureCustomer(mEmail, "SecMgr2026x");
  sql(`insert into profiles (id, full_name, role_id) select '${mid}', 'Sec Manager', id from admin_roles where key = 'manager'`);
  const b = await chromium.launch();
  try {
    // ---- failed admin sign-ins with an unknown email
    const x = await (await b.newContext()).newPage();
    for (let i = 0; i < 3; i++) {
      await x.goto(`${B}/admin/login`);
      await x.fill("#email", attacker);
      await x.fill("#password", `guess${i}Password!`);
      await x.click("button[type=submit]");
      // wait until this attempt is recorded (the previous error message may still be on screen)
      for (let t = 0; t < 40 && Number(sql(`select count(*) from security_events where email = '${attacker}'`)) < i + 1; t++) await x.waitForTimeout(250);
    }
    check(sql(`select count(*) from security_events where kind = 'admin_login_failed' and email = '${attacker}'`) === "3", "failed admin sign-ins recorded with the email used");
    check(sql(`select count(*) from security_events where email = '${attacker}' and metadata::text ilike '%guess%'`) === "0", "passwords are never stored");

    // ---- wrong two-step code + successful sign-in
    const o = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await o.goto(`${B}/admin/login`);
    await o.fill("#email", OWNER.email);
    await o.fill("#password", OWNER.password);
    await o.click("button[type=submit]");
    await o.waitForURL(/\/admin\/mfa/);
    if (await o.locator("#code").count()) {
      await o.fill("#code", "000000");
      await o.click("form button[type=submit]");
      await o.waitForSelector("form [role=alert]");
      check(sql(`select count(*) from security_events where kind = 'admin_mfa_failed' and email = '${OWNER.email}' and created_at > now() - interval '2 minutes'`) >= "1", "wrong two-step code recorded");
    }
    await adminLogin(o, B, OWNER.email, OWNER.password);
    check(sql(`select count(*) from security_events where kind = 'admin_login_success' and email = '${OWNER.email}' and created_at > now() - interval '2 minutes'`) >= "1", "successful admin sign-in recorded");

    // ---- Security page
    await o.goto(`${B}/admin/security?tab=emails`);
    const row = o.locator("tr", { hasText: attacker });
    check(await row.count() === 1 && (await row.innerText()).includes("high risk") && (await row.innerText()).includes("no account"), "suspicious email listed as high risk (no account)");
    check(Number(await o.locator("aside a[href='/admin/security'] span[aria-label]").textContent().catch(() => "0")) >= 1, "red badge on Security");
    await row.locator("input[name=reason]").fill("Guessing admin passwords");
    await row.locator("button:has-text('Block')").click();
    await toast(o, `Blocked ${attacker}`);
    await o.goto(`${B}/admin/security?tab=blocked`);
    check((await o.locator("main").innerText()).includes(attacker), "blocked list shows the email");
    await o.goto(`${B}/admin/security?tab=logins`);
    check((await o.locator("table").innerText()).includes("Admin signed in"), "admin sign-ins listed");

    // ---- blocked email cannot sign up
    const s = await (await b.newContext()).newPage();
    await s.goto(`${B}/account/signup`);
    await s.fill("#fullName", "Bad Actor");
    await s.fill("#email", attacker);
    await s.fill("#password", "BadActor2026x");
    await s.fill("#confirm", "BadActor2026x");
    await s.check("input[name=acceptTerms]");
    await s.click("form button[type=submit]");
    await s.waitForSelector("form [role=alert]");
    check((await s.locator("form [role=alert]").innerText()).includes("cannot be used"), "blocked email cannot sign up");

    // ---- customer: failed sign-ins, then blocked → signed out, cannot sign in or order
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, cust, "SecCust2026x");
    const w = await (await b.newContext()).newPage();
    await w.goto(`${B}/account/login`);
    await w.fill("#email", cust);
    await w.fill("#password", "WrongPassword1");
    await w.click("form button[type=submit]");
    await w.waitForSelector("form [role=alert]");
    check(sql(`select count(*) from security_events where kind = 'customer_login_failed' and email = '${cust}'`) === "1", "failed customer sign-in recorded");
    await o.goto(`${B}/admin/security?tab=blocked`);
    await o.fill("input[name=email]", cust);
    await o.fill("main input[name=reason] >> nth=0", "Fake receipts");
    await o.click("main button:has-text('Block') >> nth=0");
    await toast(o, `Blocked ${cust}`);
    check(sql(`select coalesce(banned_until > now(), false) || ':' || (select deactivated_at is not null from customer_accounts where id = '${cid}') from auth.users where id = '${cid}'`) === "true:true",
      "existing account deactivated and banned");
    await c.goto(`${B}/account`);
    check(new URL(c.url()).pathname === "/account/login", "the customer's open session stops working");
    await c.fill("#email", cust);
    await c.fill("#password", "SecCust2026x");
    await c.click("form button[type=submit]");
    await c.waitForSelector("form [role=alert]");
    check((await c.locator("form [role=alert]").innerText()).includes("cannot be used"), "blocked customer cannot sign in");
    // Isolate the email rule: lift the deactivation and the sign-in ban for this one check.
    sql(`update customer_accounts set deactivated_at = null where id = '${cid}'; update auth.users set banned_until = null where id = '${cid}'`);
    let refused = false;
    try {
      sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key', gen_random_uuid(),'access_token_hash',repeat('a',64),'tracking_code_hash',repeat('b',64),
        'customer',jsonb_build_object('full_name','X Y','phone','+251911223300'),'fulfillment',jsonb_build_object('method','pickup'),
        'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
    } catch (e) { refused = /email_blocked/.test(String(e.stderr ?? e.message)); }
    check(refused, "database refuses orders from a blocked email");
    sql(`update customer_accounts set deactivated_at = now(), deactivation_reason = 'Blocked email: Fake receipts' where id = '${cid}'; update auth.users set banned_until = now() + interval '100 years' where id = '${cid}'`);

    // ---- unblock
    await o.goto(`${B}/admin/security?tab=blocked`);
    await o.locator("tr", { hasText: cust }).locator("button:has-text('Unblock')").click();
    await toast(o, `Unblocked ${cust}`);
    const c2 = await (await b.newContext()).newPage();
    await loginCustomer(c2, B, cust, "SecCust2026x");
    check(new URL(c2.url()).pathname === "/account", "unblocked customer can sign in again");
    check(sql(`select count(*) from audit_logs where action in ('email_blocked','email_unblocked') and entity_id in ('${attacker}','${cust}')`) === "3", "blocks and unblocks are in the Activity log");

    // ---- suspicious customers + health
    for (let i = 0; i < 3; i++) {
      sql(`set role service_role; select public.create_order_for_user('${cid}', jsonb_build_object('idempotency_key', gen_random_uuid(),'access_token_hash',encode(sha256(gen_random_uuid()::text::bytea),'hex'),'tracking_code_hash',repeat('b',64),
        'customer',jsonb_build_object('full_name','Sec Cust','phone','+251911223300'),'fulfillment',jsonb_build_object('method','pickup'),
        'items',jsonb_build_array(jsonb_build_object('type','product','product_id','20000000-0000-0000-0000-000000000007','quantity',1))))`);
    }
    sql(`update orders set status = 'expired' where user_id = '${cid}'`);
    await o.goto(`${B}/admin/security?tab=customers`);
    const crow = o.locator("tr", { hasText: cust });
    check(await crow.count() === 1 && (await crow.innerText()).includes("never paid"), "customer with repeated unpaid orders flagged");
    await fetch(`${B}/api/cron/expire-orders`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    await o.goto(`${B}/admin/security`);
    const ov = await o.locator("main").innerText();
    check(/Expire unpaid orders: ran \d+ min ago/.test(ov), "site health shows when the scheduled job last ran");
    check(ov.includes("Customer emails"), "site health lists configuration checks");

    // ---- permissions
    const m = await (await b.newContext()).newPage();
    await adminLogin(m, B, mEmail, "SecMgr2026x");
    check((await m.goto(`${B}/admin/security`)).status() === 404, "managers cannot open Security");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    await b.close();
    sql(`update profiles set is_active = false where id = '${mid}'`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
