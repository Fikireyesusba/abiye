/**
 * Customer account management browser test: reset/invite/deactivate/delete,
 * activity timeline + log, saved baskets and stalled checkouts.
 * LOCAL Supabase (mail catcher on :54324) + app on BASE_URL.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/customer-admin.smoke.cjs
 * Mutates the local database. Never point it at production.
 */
const { chromium } = require("playwright");
const { adminLogin } = require("./_admin.cjs");
const { execSync } = require("child_process");
const { ensureCustomer, loginCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const MAIL = "http://127.0.0.1:54324";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHARGER = "20000000-0000-0000-0000-000000000007";

const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });
async function mailCount(to, subjectPart) {
  const found = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
  return (found.messages ?? []).filter((m) => m.Subject.includes(subjectPart)).length;
}
async function waitMail(to, subjectPart, atLeast = 1) {
  for (let i = 0; i < 40; i++) {
    if ((await mailCount(to, subjectPart)) >= atLeast) return true;
    await sleep(500);
  }
  return false;
}
async function waitFor(fn, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await sleep(500);
  }
  return false;
}

(async () => {
  sql("delete from rate_limits");
  const aEmail = `cm-a-${RUN}@example.com`;
  const bEmail = `cm-b-${RUN}@example.com`;
  const mEmail = `cm-mgr-${RUN}@example.com`;
  const invitee = `cm-inv-${RUN}@example.com`;
  const A = await ensureCustomer(aEmail, "CustomerA2026");
  const Bid = await ensureCustomer(bEmail, "CustomerB2026");
  const M = await ensureCustomer(mEmail, "Manager2026x");
  sql(`insert into profiles (id, full_name, role_id) select '${M}', 'CM Manager ${RUN}', id from admin_roles where key = 'manager'`);
  // Customer B has an order (cannot be deleted)
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order_for_user('${Bid}', jsonb_build_object(
    'idempotency_key','${key}','access_token_hash',encode(sha256('tok-${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('trk-${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','CM Buyer','phone','+251911223355'),
    'fulfillment',jsonb_build_object('method','pickup'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','${CHARGER}','quantity',1))))`);

  const b = await chromium.launch();
  try {
    // ---------------------------------------------------------------- basket
    const cctx = await b.newContext();
    const cp = await cctx.newPage();
    await loginCustomer(cp, B, aEmail, "CustomerA2026");
    await cp.goto(`${B}/shop`);
    await cp.evaluate((id) => {
      localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: id, quantity: 3 }]));
      window.dispatchEvent(new Event("cart:change"));
    }, CHARGER);
    check(await waitFor(() => sql(`select item_count from customer_carts where user_id = '${A}'`) === "3"), "signed-in basket is saved to the account");
    // Guests: nothing saved
    const gp = await (await b.newContext()).newPage();
    await gp.goto(`${B}/shop`);
    await gp.evaluate((id) => { localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: id, quantity: 1 }])); window.dispatchEvent(new Event("cart:change")); }, CHARGER);
    await sleep(2500);
    check(sql("select count(*) from customer_carts where user_id not in (select id from auth.users)") === "0", "guest baskets are not saved");
    sql(`alter table customer_carts disable trigger customer_carts_touch; update customer_carts set updated_at = now() - interval '3 hours' where user_id = '${A}'; alter table customer_carts enable trigger customer_carts_touch`);
    sql(`alter table orders disable trigger orders_updated_at; update orders set updated_at = now() - interval '3 hours' where idempotency_key = '${key}'; alter table orders enable trigger orders_updated_at`);

    // ---------------------------------------------------------------- owner
    const op = await (await b.newContext()).newPage();
    await adminLogin(op, B, OWNER.email, OWNER.password);
    check(await op.locator("a:has-text('Stalled checkouts (2h+)')").count() === 1, "dashboard shows stalled checkouts");
    await op.goto(`${B}/admin/follow-up`);
    const basketRow = op.locator("section:has(h2:has-text('Baskets')) tr", { hasText: aEmail });
    check(await basketRow.count() === 1 && (await basketRow.innerText()).includes("3 ×"), "follow-up lists the abandoned basket with items");
    check(await op.locator("section:has(h2:has-text('Orders not paid')) tr", { hasText: bEmail }).count() === 1, "follow-up lists the unpaid order");
    await op.goto(`${B}/admin/follow-up?hours=6`);
    check(await op.locator("tr", { hasText: aEmail }).count() === 0, "threshold filter works");

    // reset email
    await op.goto(`${B}/admin/customers/${A}`);
    const before = await mailCount(aEmail, "");
    await op.click("button:has-text('Send password reset email')");
    await toast(op, "Password reset email sent");
    check(await waitMail(aEmail, "", before + 1), "password reset email delivered");

    // deactivate
    op.once("dialog", (d) => d.accept());
    await op.fill("#reason", "Repeated fake receipts");
    await op.click("button:has-text('Deactivate account')");
    await toast(op, "Account deactivated");
    check(sql(`select deactivation_reason from customer_accounts where id = '${A}'`) === "Repeated fake receipts", "deactivation stored with reason");
    check(sql(`select banned_until > now() from auth.users where id = '${A}'`) === "t", "Supabase sign-in ban applied");
    await op.reload();
    check(await op.locator("text=This customer cannot sign in or place orders").count() === 1, "deactivated banner shown");

    // existing session stops working; new sign-in refused
    await cp.goto(`${B}/account`);
    check(cp.url().includes("/account/login"), "open customer session is no longer accepted");
    await cp.context().clearCookies();
    await cp.goto(`${B}/account/login`);
    await cp.fill("#email", aEmail);
    await cp.fill("#password", "CustomerA2026");
    await cp.click("form button[type=submit]");
    await cp.waitForSelector("form [role=alert]");
    check((await cp.locator("form [role=alert]").innerText()).includes("deactivated"), "deactivated customer cannot sign in");

    // reactivate
    await op.goto(`${B}/admin/customers/${A}`);
    await op.click("button:has-text('Reactivate account')");
    await toast(op, "Account reactivated");
    check(sql(`select coalesce(banned_until > now(), false) from auth.users where id = '${A}'`) === "f", "ban lifted");
    await loginCustomer(cp, B, aEmail, "CustomerA2026");
    check(cp.url().includes("/account"), "reactivated customer can sign in");

    // timeline
    await op.reload();
    const page = await op.locator("main").innerText();
    check(page.includes("Account deactivated") && page.includes("Repeated fake receipts") && page.includes("Account reactivated"), "timeline: deactivation with reason and reactivation");
    check(page.includes("Password reset email sent"), "timeline: reset email");
    check(page.includes("Signed in"), "timeline: sign-ins");
    check(page.includes("by "), "timeline: actor names");

    // activity log
    await op.goto(`${B}/admin/activity?cat=customers`);
    const log = await op.locator("table").innerText();
    check(log.includes("Account deactivated") && log.includes(aEmail), "activity log lists the change with the account");

    // invite, resend, delete
    await op.goto(`${B}/admin/customers`);
    await op.click("summary:has-text('Invite a customer')");
    await op.fill("#invite-email", invitee);
    await op.fill("#invite-name", "Invited Person");
    await op.click("button:has-text('Send invitation')");
    await toast(op, "Invitation sent");
    check(await waitMail(invitee, ""), "invitation email delivered");
    const invId = sql(`select id from auth.users where email = '${invitee}'`);
    check(sql(`select full_name from customer_accounts where id = '${invId}'`) === "Invited Person", "invited account created with the name");
    await op.goto(`${B}/admin/customers/${invId}`);
    await op.click("button:has-text('Send invitation again')");
    await toast(op, "Invitation sent");
    check(await waitMail(invitee, "", 2), "invitation can be sent again before confirming");
    op.once("dialog", (d) => d.accept());
    await op.click("button:has-text('Delete account')");
    await op.waitForURL(/\/admin\/customers\?deleted=1/);
    check(sql(`select count(*) from auth.users where id = '${invId}'`) === "0", "account deleted");
    await op.goto(`${B}/admin/activity?q=customer_deleted`);
    check((await op.locator("table").innerText()).includes(invitee), "deletion is kept in the activity log with the email");

    // guards
    await op.goto(`${B}/admin/customers/${Bid}`);
    check(await op.locator("button:has-text('Delete account')").count() === 0
      && await op.locator("text=Accounts with orders cannot be deleted").count() === 1, "accounts with orders cannot be deleted");
    await op.goto(`${B}/admin/customers/${M}`);
    check(await op.locator("text=This is a staff account").count() === 1 && await op.locator("button:has-text('Deactivate account')").count() === 0,
      "staff accounts are not managed here");

    // manager: view only
    const mp = await (await b.newContext()).newPage();
    await adminLogin(mp, B, mEmail, "Manager2026x");
    await mp.goto(`${B}/admin/customers/${A}`);
    check(await mp.locator("text=Manage account").count() === 0 && (await mp.locator("main").innerText()).includes("Signed in"),
      "managers see the timeline but cannot manage accounts");
    const r = await mp.goto(`${B}/admin/activity`);
    check(r.status() === 404, "managers cannot open the activity log");
    await mp.goto(`${B}/admin/follow-up`);
    check((await mp.locator("h1").innerText()).includes("Stalled checkouts"), "managers can open stalled checkouts");

    // ordering empties the saved basket (via the real checkout path in SQL)
    sql(`set role service_role; select public.create_order_for_user('${A}', jsonb_build_object(
      'idempotency_key',gen_random_uuid(),'access_token_hash',encode(sha256(('a'||gen_random_uuid())::bytea),'hex'),'tracking_code_hash',encode(sha256(('b'||gen_random_uuid())::bytea),'hex'),
      'customer',jsonb_build_object('full_name','CM A','phone','+251911223366'),'fulfillment',jsonb_build_object('method','pickup'),
      'items',jsonb_build_array(jsonb_build_object('type','product','product_id','${CHARGER}','quantity',1))))`);
    check(sql(`select count(*) from customer_carts where user_id = '${A}'`) === "0", "placing an order clears the saved basket");
  } catch (e) {
    check(false, `crashed: ${e.message}`);
  } finally {
    await b.close();
    sql(`update profiles set is_active = false where id = '${M}'`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
