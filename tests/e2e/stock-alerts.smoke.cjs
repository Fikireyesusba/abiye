/**
 * Stock alerts: "Notify me when available" on sold-out products; staff alerts at the low-stock level
 * and when sold out; customers told when restocked; admin badge and waiting counts.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/stock-alerts.smoke.cjs
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
const SLUG = `e2e-notify-${RUN}`;
const SKU = `E2E-NTF-${RUN.toUpperCase()}`;

(async () => {
  sql("delete from rate_limits");
  // A fresh active product (copy of the sample charger) that is sold out.
  sql(`do $$ declare cols text; begin
    select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns
     where table_schema = 'public' and table_name = 'products' and is_generated = 'NEVER' and column_default is distinct from 'gen_random_uuid()'
       and column_name not in ('slug', 'sku', 'name_en', 'stock_quantity', 'status', 'low_stock_threshold', 'track_inventory', 'created_at', 'updated_at');
    execute format('insert into public.products (slug, sku, name_en, stock_quantity, status, low_stock_threshold, track_inventory, %s)
                    select %L, %L, %L, 0, ''active'', 3, true, %s from public.products where sku = ''SMP-CH-001''', cols, '${SLUG}', '${SKU}', 'Notify Charger ${RUN}', cols);
  end $$;`);
  const pid = sql(`select id from products where slug = '${SLUG}'`);
  const email = `notify-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "NotifyE2E2026x");
  const b = await chromium.launch();
  try {
    // ---- signed out: asked to sign in, returns to the product
    const v = await (await b.newContext()).newPage();
    await v.goto(`${B}/products/${SLUG}`);
    const link = v.locator("a:has-text('Sign in to be notified')");
    await link.waitFor();
    check((await link.getAttribute("href")) === `/account/login?next=${encodeURIComponent(`/products/${SLUG}`)}`, "signed-out visitors are asked to sign in (returns to the product)");
    check(await v.locator("button[aria-label='Increase quantity'], button[aria-label='Decrease quantity']").count() === 0, "no quantity / add-to-basket for the sold-out product (related products may still show theirs)");

    // ---- customer asks, cancels, asks again
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "NotifyE2E2026x");
    await c.goto(`${B}/products/${SLUG}`);
    await c.click("button:has-text('Notify me when available')");
    await c.waitForSelector("text=We'll email you when it's back in stock.");
    check(sql(`select count(*) from stock_alerts where product_id = '${pid}' and user_id = '${uid}' and notified_at is null`) === "1", "request saved");
    await c.reload();
    await c.waitForSelector("button:has-text('Stop notifying me')");
    check(true, "still shown after reloading");
    await c.click("button:has-text('Stop notifying me')");
    await c.waitForSelector("button:has-text('Notify me when available')");
    check(sql(`select count(*) from stock_alerts where product_id = '${pid}' and user_id = '${uid}'`) === "0", "request cancelled");
    await c.click("button:has-text('Notify me when available')");
    await c.waitForSelector("text=We'll email you when it's back in stock.");

    // ---- admin: badge, waiting count, restock → customer told
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/inventory?filter=low`);
    const nav = await o.locator("nav a[href='/admin/inventory']").first().innerText();
    check(/\d/.test(nav), `Inventory has a red badge (${nav.replace(/\s+/g, " ")})`);
    const row = o.locator("tr", { hasText: `Notify Charger ${RUN}` });
    check((await row.innerText()).includes("1 customer waiting"), "inventory shows 1 customer waiting");
    const before = Number(sql("select coalesce(max(id),0) from notifications_outbox"));
    await row.locator("input[name=change]").fill("10");
    await row.locator("button:has-text('Apply')").click();
    await o.waitForSelector("[data-sonner-toast]");
    await o.waitForTimeout(500);
    check(sql(`select stock_quantity from products where id = '${pid}'`) === "10", "restocked");
    check(sql(`select count(*) from notifications_outbox where id > ${before} and event_type = 'customer_back_in_stock' and recipient_user_id = '${uid}' and channel = 'email'`) === "1",
      "customer emailed when it is back");
    check(sql(`select notified_at is not null from stock_alerts where product_id = '${pid}' and user_id = '${uid}'`) === "t", "request closed after telling the customer");

    // ---- selling down: low-stock alert at 3, sold-out alert at 0 (Telegram + staff email)
    const mark = Number(sql("select coalesce(max(id),0) from notifications_outbox"));
    await o.goto(`${B}/admin/inventory`);
    const row2 = o.locator("tr", { hasText: `Notify Charger ${RUN}` });
    await row2.locator("input[name=change]").fill("-7");
    await row2.locator("select[name=reason]").selectOption("damage");
    await row2.locator("button:has-text('Apply')").click();
    await o.waitForSelector("[data-sonner-toast]");
    await o.waitForTimeout(500);
    check(sql(`select count(*) from notifications_outbox where id > ${mark} and event_type = 'low_stock' and payload->>'product_id' = '${pid}'`) === "1", "Telegram low-stock alert at the alert level");
    check(Number(sql(`select count(*) from notifications_outbox where id > ${mark} and event_type = 'staff_low_stock' and payload->>'product_id' = '${pid}'`)) >= 1, "low-stock email to staff who manage stock");
    await o.reload();
    const row3 = o.locator("tr", { hasText: `Notify Charger ${RUN}` });
    await row3.locator("input[name=change]").fill("-3");
    await row3.locator("select[name=reason]").selectOption("damage");
    await row3.locator("button:has-text('Apply')").click();
    await o.waitForSelector("[data-sonner-toast]");
    await o.waitForTimeout(500);
    check(sql(`select count(*) from notifications_outbox where id > ${mark} and event_type = 'out_of_stock' and payload->>'product_id' = '${pid}'`) === "1", "sold-out alert");
    await v.goto(`${B}/products/${SLUG}`);
    await v.locator("a:has-text('Sign in to be notified')").waitFor();
    check(true, "the product shows the notify option again once sold out");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    await b.close();
    sql(`update products set status = 'archived' where slug = '${SLUG}'`);
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
