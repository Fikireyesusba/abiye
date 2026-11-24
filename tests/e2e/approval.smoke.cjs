/**
 * New customer accounts wait for approval: notice on every page, browse + support only, approve / reject in admin.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/approval.smoke.cjs
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
  const goodEmail = `newbie-${RUN}@example.com`;
  const badEmail = `shady-${RUN}@example.com`;
  const goodId = await ensureCustomer(goodEmail, "NewbieE2E2026x", { approved: false });
  const badId = await ensureCustomer(badEmail, "ShadyE2E2026x", { approved: false });
  sql(`update customer_accounts set full_name = 'Newbie Person', phone = '+251911778899' where id = '${goodId}'`);
  const b = await chromium.launch();
  try {
    // ---- pending customer: notice, browse, no ordering, support works
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, goodEmail, "NewbieE2E2026x");
    await c.goto(`${B}/`);
    check((await c.locator("[data-testid=account-pending]").innerText()).includes("under verification"), "pending: “Your account is under verification” on every page");
    await c.goto(`${B}/account/wallet/top-up`);
    check((await c.locator("[data-testid=account-pending]").count()) === 1, "pending: can still browse their account pages");
    check(sql(`select count(*) from notifications_outbox where event_type = 'account_pending' and payload->>'user_id' = (select member_id from customer_accounts where id = '${goodId}')`) === "1",
      "new account announced in the security Telegram group");

    // ---- approver: sees details, approves one, rejects the other
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/approvals`);
    const card = o.locator("[data-testid=pending-account]", { hasText: goodEmail });
    const txt = await card.innerText();
    check(txt.includes("Newbie Person") && txt.includes(goodEmail) && /Phone: \S/.test(txt), "approver sees the details the customer gave (name, email, phone…)");
    check(await o.locator("aside a[href='/admin/approvals']").count() === 1, "menu: Account approvals");
    await card.locator("button:has-text('Approve')").click();
    await toast(o, "Approved");
    check(sql(`select approval_status from customer_accounts where id = '${goodId}'`) === "approved", "approved");
    const bad = o.locator("[data-testid=pending-account]", { hasText: badEmail });
    await bad.locator("input[name=reason]").fill("Details could not be verified");
    await bad.locator("button:has-text('Reject')").click();
    await toast(o, "Rejected");
    check(sql(`select count(*) from auth.users where id = '${badId}'`) === "0", "rejected: the account is deleted");
    check(sql(`select reason from blocked_emails where email = '${badEmail}'`).includes("Details could not be verified"), "rejected: the email is on the block list with the reason");
    check(sql(`select count(*) from audit_logs where action = 'account_rejected' and metadata->>'reason' = 'Details could not be verified'`) === "1", "rejection in the Activity log");

    // ---- approved customer: notice gone
    await c.goto(`${B}/`);
    check((await c.locator("[data-testid=account-pending]").count()) === 0, "approved: the notice is gone");
    // ---- rejected email cannot sign up / sign in again
    const x = await (await b.newContext()).newPage();
    await x.goto(`${B}/account/login`);
    await x.fill("input[type=email]", badEmail);
    await x.fill("input[type=password]", "ShadyE2E2026x");
    await x.click("main form button[type=submit]");
    await x.waitForTimeout(1500);
    check(new URL(x.url()).pathname === "/account/login", "rejected email cannot sign in");
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
