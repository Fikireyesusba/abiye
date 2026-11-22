/**
 * Support & feedback tickets (customer + admin), signed-in users (sign out), last sign-in, app installs, activity by User ID.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/support-sessions.smoke.cjs
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

(async () => {
  sql("delete from rate_limits where true");
  const email = `support-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "SupportE2E2026x");
  const mid = sql(`select member_id from customer_accounts where id = '${uid}'`);
  const b = await chromium.launch();
  try {
    // ---- signed out: support needs sign-in
    const anon = await (await b.newContext()).newPage();
    await anon.goto(`${B}/support`);
    check(new URL(anon.url()).pathname === "/account/login", "Support & feedback: signed-out visitors are sent to sign in");

    // ---- customer: the installed app is counted (display-mode standalone emulated)
    const ctx = await b.newContext();
    await ctx.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q));
    });
    const c = await ctx.newPage();
    await loginCustomer(c, B, email, "SupportE2E2026x", "/support");
    await c.waitForURL(/\/support$/);
    for (let i = 0; i < 20 && sql(`select count(*) from app_installs where user_id = '${uid}'`) === "0"; i++) await c.waitForTimeout(300);
    check(sql(`select count(*) from app_installs where user_id = '${uid}'`) === "1", "opening the installed app is counted for this account");

    // ---- profile menu entry
    await c.goto(`${B}/`);
    await c.click("header button[aria-controls=account-menu]");
    check(await c.locator('#account-menu a[href="/support"]').count() === 1, "profile menu has Support & feedback");

    // ---- new ticket: topic decides the fields
    await c.goto(`${B}/support`);
    await c.selectOption("#topic", "order");
    check(await c.locator("#orderNumber[required]").count() === 1 && await c.locator("#subject").count() === 0, "order topic asks for the order number");
    await c.fill("#orderNumber", "ET-99999999");
    await c.fill("#details", "My order has not arrived after three days.");
    await c.click("[data-testid=support-form] button[type=submit]");
    await c.waitForSelector("text=None of your orders");
    check(true, "someone else's / unknown order number refused");
    await c.selectOption("#topic", "other");
    check(await c.locator("#subject").count() === 1 && await c.locator("#orderNumber").count() === 0, "'other' asks for a short title");
    await c.fill("#subject", `Idea ${RUN}`);
    await c.fill("#details", "Please add gift wrapping as an option at checkout.");
    await c.click("[data-testid=support-form] button[type=submit]");
    await c.waitForSelector("text=/ticket T-\\d+ was created/");
    const ticketNumber = (await c.locator("text=/T-\\d+/").first().innerText()).match(/T-\d+/)[0];
    const ticketId = sql(`select id from support_tickets where ticket_number = '${ticketNumber}'`);
    check(!!ticketId && sql(`select category || '|' || status from support_tickets where id = '${ticketId}'`) === "other|open", `ticket ${ticketNumber} created (open)`);
    check(sql(`select count(*) from notifications_outbox where event_type = 'support_ticket' and payload->>'ticket_id' = '${ticketId}' and payload->>'user_id' = '${mid}'`) === "1",
      "sent to the support Telegram group with the User ID");
    await c.goto(`${B}/support`);
    check((await c.locator("[data-testid=my-tickets]").innerText()).includes(ticketNumber), "listed under My tickets");

    // ---- admin: tickets with red count, reply, internal note, status
    const o = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } })).newPage();
    o.on("dialog", (d) => d.accept());
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/support?q=${mid}`);
    check((await o.locator("main").innerText()).includes(ticketNumber) && (await o.locator("main").innerText()).includes(`User ID ${mid}`) && !(await o.locator("main").innerText()).includes(email), "admin finds the ticket by User ID (only the User ID listed)");
    check(await o.locator('nav a[href="/admin/support"] span[title*="open support"]').count() === 1, "menu shows a red count of open tickets");
    await o.goto(`${B}/admin/support/${ticketId}`);
    await o.fill("textarea[name=message]", "Thanks for the idea — we are looking into it.");
    await o.click("form button:has-text('Save')");
    await o.waitForSelector("[data-sonner-toast]:has-text('Reply sent')");
    await o.fill("textarea[name=message]", "Ask the supplier about wrapping paper.");
    await o.check("input[name=internal]");
    await o.click("form button:has-text('Save')");
    await o.waitForSelector("[data-sonner-toast]:has-text('Internal note saved')");
    check(sql(`select status from support_tickets where id = '${ticketId}'`) === "waiting_customer", "reply → waiting for the customer");
    check(sql(`select count(*) from notifications_outbox where event_type = 'customer_ticket_update' and recipient_user_id = '${uid}'`) >= "1", "customer emailed about the reply");

    // ---- customer sees the reply (not the note) and answers
    await c.goto(`${B}/support/${ticketId}`);
    const conv = await c.locator("[data-testid=ticket-messages]").innerText();
    check(conv.includes("looking into it") && !conv.includes("supplier"), "customer sees the reply, not the internal note");
    await c.fill("#body", "Great, thank you!");
    await c.click("button:has-text('Send')");
    await c.waitForSelector("text=Message sent.");
    check(sql(`select status from support_tickets where id = '${ticketId}'`) === "open", "customer answer re-opens the ticket");
    await o.goto(`${B}/admin/support/${ticketId}`);
    await o.selectOption("select[name=status]", "resolved");
    await o.click("form button:has-text('Save')");
    await o.waitForSelector("[data-sonner-toast]:has-text('Ticket updated')");
    await c.goto(`${B}/support/${ticketId}`);
    check((await c.locator("[data-testid=ticket-status]").innerText()).includes("Resolved"), "customer sees it resolved");

    // ---- activity: everything by / about this User ID
    await o.goto(`${B}/admin/activity?q=${mid}`);
    const act = await o.locator("main").innerText();
    check(act.includes("Support ticket opened") && act.includes(`User ID ${mid}`), "activity log searched by User ID shows the customer's actions with their User ID");

    // ---- signed-in users and sign out
    await o.goto(`${B}/admin/users?tab=now&q=${mid}`);
    check((await o.locator("main").innerText()).includes(`User ID ${mid}`) && !(await o.locator("main").innerText()).includes(email), "customer listed as signed in now (only the User ID)");
    const [xl] = await Promise.all([o.waitForEvent("download"), o.click("[data-testid=users-export]")]);
    const wb = new (require("exceljs").Workbook)();
    await wb.xlsx.readFile(await xl.path());
    const ws = wb.worksheets[0];
    let xrow = null;
    ws.eachRow((r) => { if (String(r.getCell(1).value) === mid) xrow = r; });
    check(!!xrow && String(xrow.getCell(3).value) === email && String(xrow.getCell(11).value).length > 0, "Excel export of signed-in users with all details (email, last active…)");
    await o.locator(`tr:has-text("User ID ${mid}") button:has-text('Sign out')`).click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Signed out')");
    await c.goto(`${B}/support`);
    check(new URL(c.url()).pathname === "/account/login", "the customer is signed out at once");
    sql(`update auth.users set last_sign_in_at = now() - interval '60 days' where id = '${uid}'`);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date(Date.now() - 30 * 86400000));
    await o.goto(`${B}/admin/users?tab=last&before=${day}&q=${mid}`);
    check((await o.locator("main").innerText()).includes(`User ID ${mid}`), "last sign-in: 'not signed in since' filter finds them");
    await o.goto(`${B}/admin/users?tab=last&from=${day}&q=${mid}`);
    check(!(await o.locator("main").innerText()).includes(`User ID ${mid}`), "last sign-in: date range filter");

    // ---- app installs
    await o.goto(`${B}/admin/users?tab=installs`);
    check(Number(await o.locator("[data-testid=install-count]").innerText()) >= 1 && (await o.locator("main").innerText()).includes(`User ID ${mid}`), "App installs: count and list with the person's User ID");
    await o.click(`a[href="/admin/users/${mid}"]`);
    await o.waitForURL(new RegExp(`/admin/customers/${uid}`));
    check((await o.locator("[data-testid=sign-in-panel]").innerText()).includes("App installed on: Android") || (await o.locator("[data-testid=sign-in-panel]").innerText()).includes("App installed on:"), "clicking a User ID opens the person (customer page with sign-in & devices)");
    const ownerMid = sql("select a.member_id from customer_accounts a join auth.users u on u.id = a.id where u.email = 'owner@abiye.local'");
    await o.goto(`${B}/admin/users/${ownerMid}`);
    check((await o.locator("[data-testid=user-details]").innerText()).includes("owner@abiye.local"), "a staff User ID opens their details page");
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
