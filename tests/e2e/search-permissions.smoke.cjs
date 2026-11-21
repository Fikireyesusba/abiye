/**
 * Search with dates (security events, notifications, activity log) and permission sets / personal permissions.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/search-permissions.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
const toast = (p, t) => p.waitForSelector(`[data-sonner-toast]:has-text("${t}")`, { timeout: 15000 });

(async () => {
  sql("delete from rate_limits");
  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);

    // ---- search with dates
    sql(`insert into security_events (kind, email, ip_hash, created_at) values ('customer_login_failed', 'find-${RUN}@example.com', md5('x'), now()),
         ('customer_login_failed', 'old-${RUN}@example.com', md5('y'), now() - interval '40 days')`);
    await o.goto(`${B}/admin/security?tab=events&q=${RUN}&from=${today}&to=${today}`);
    const ev = await o.locator("main").innerText();
    check(ev.includes(`find-${RUN}@example.com`) && !ev.includes(`old-${RUN}@example.com`), "security events: text + date search");
    sql(`insert into notifications_outbox (event_type, dedupe_key, payload, status, sent_at) values ('test_message', 'srch-${RUN}', '{"order_number":"ET-S${RUN}"}', 'sent', now())`);
    await o.goto(`${B}/admin/notifications?tab=messages`);
    await o.fill("[data-testid=notif-search] input[name=q]", `ET-S${RUN}`);
    await o.fill("[data-testid=notif-search] input[name=from]", today);
    await o.click("[data-testid=notif-search] button[type=submit]");
    await o.waitForURL(/q=ET-S/);
    check((await o.locator("main").innerText()).includes("1 message found"), "notifications: search by order number and date");
    await o.goto(`${B}/admin/activity?q=export&from=2099-01-01&to=2099-01-02`);
    check(await o.locator("main tbody tr:has-text('No activity found')").count() === 1, "activity log: date range filter");

    // ---- permission sets
    await o.goto(`${B}/admin/staff?tab=roles`);
    const form = o.locator("form:has(button:has-text('Create permission set'))");
    await form.locator("input[name=name]").fill(`Cashier ${RUN}`);
    await form.locator("input[value='orders.manage']").check();
    await form.locator("input[value='orders.view_all']").check();
    await form.locator("button:has-text('Create permission set')").click();
    await toast(o, "created");
    const roleKey = sql(`select key from admin_roles where name = 'Cashier ${RUN}'`);
    check(sql(`select string_agg(permission_key, ',' order by permission_key) from role_permissions rp join admin_roles r on r.id = rp.role_id where r.key = '${roleKey}'`)
      === "dashboard.view,orders.manage,orders.view_all", "new permission set created with its permissions");
    check(await o.locator("input[value='staff.manage']").count() === 0, "“Manage staff” is never offered (Super Admin only)");

    // a staff member: assign the set, then a personal permission
    const mail = `perm-${RUN}@example.com`;
    const uid = await ensureCustomer(mail, "PermE2E2026x");
    sql(`insert into profiles (id, full_name, role_id) values ('${uid}', 'Perm Person', (select id from admin_roles where key = 'staff'))`);
    await o.goto(`${B}/admin/staff`);
    const row = o.locator(`tr:has-text("${mail}")`);
    await row.locator("select[name=role]").selectOption(roleKey);
    await row.locator("form:has(select[name=role]) button[type=submit]").click();
    await toast(o, "updated");
    check(sql(`select r.key from profiles p join admin_roles r on r.id = p.role_id where p.id = '${uid}'`) === roleKey, "set assigned under Team");
    await o.goto(`${B}/admin/staff?tab=personal`);
    const item = o.locator(`details[data-member="${mail}"]`);
    await item.locator("summary").click();
    check(await item.locator("input[value='orders.manage']:disabled:checked").count() === 1, "permissions from the set shown ticked and locked");
    await item.locator("input[value='customers.view']").check();
    await item.locator("button:has-text('Save personal permissions')").click();
    await toast(o, "Personal permissions saved");
    check(sql(`select string_agg(permission_key, ',') from profile_permissions where profile_id = '${uid}'`) === "customers.view", "personal permission saved");
    check(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated","aal":"aal2"}', false);
               select (public.my_admin_context() -> 'permissions') ? 'customers.view' and (public.my_admin_context() ->> 'role_name') = 'Cashier ${RUN}'`) === "t",
      "the person gets set + personal permissions");
    // clean up
    sql(`delete from profile_permissions where profile_id = '${uid}'; delete from profiles where id = '${uid}'; delete from admin_roles where key = '${roleKey}'`);
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
