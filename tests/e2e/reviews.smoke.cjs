/**
 * Product reviews: only customers who received the product can review; nothing public until approved;
 * edits go back for approval; rejection reason shown to the customer; ratings on product page and cards.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/reviews.smoke.cjs
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
const CHARGER = "20000000-0000-0000-0000-000000000007";
const SLUG = "sample-usb-c-fast-charger";

function order(uid, status) {
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order_for_user('${uid}', jsonb_build_object('idempotency_key','${key}',
    'access_token_hash',encode(sha256('a${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('b${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','Review Buyer','phone','+251911223397'),'fulfillment',jsonb_build_object('method','pickup'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','${CHARGER}','quantity',1))))`);
  const id = sql(`select id from orders where idempotency_key = '${key}'`);
  if (status) sql(`update orders set status = '${status}' where id = '${id}'`);
  return id;
}

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where id = '20000000-0000-0000-0000-000000000007'");
  const email = `review-${RUN}@example.com`;
  const uid = await ensureCustomer(email, "ReviewE2E2026x");
  sql(`update customer_accounts set full_name = 'Selam ${RUN} Tesfaye' where id = '${uid}'`);
  const orderId = order(uid, "completed");
  const other = `review-other-${RUN}@example.com`;
  const otherId = await ensureCustomer(other, "ReviewE2E2026x");
  order(otherId, null); // not received yet
  const COMMENT = `Charges my phone fast ${RUN}`;
  const b = await chromium.launch();
  try {
    // ---- signed out / not received: no form
    const anon = await (await b.newContext()).newPage();
    await anon.goto(`${B}/products/${SLUG}`);
    await anon.waitForSelector("#reviews");
    await anon.waitForTimeout(1200);
    check(await anon.locator("[data-testid=review-form]").count() === 0, "visitors cannot write a review");
    const o2 = await (await b.newContext()).newPage();
    await loginCustomer(o2, B, other, "ReviewE2E2026x");
    await o2.goto(`${B}/products/${SLUG}`);
    await o2.waitForSelector("#reviews");
    await o2.waitForTimeout(1500);
    check(await o2.locator("[data-testid=review-form]").count() === 0, "customers who have not received it cannot review");

    // ---- customer who received it
    const c = await (await b.newContext()).newPage();
    await loginCustomer(c, B, email, "ReviewE2E2026x");
    await c.goto(`${B}/order-success/${orderId}`);
    const write = c.locator(`a[href='/products/${SLUG}#reviews']`);
    check(await write.count() === 1, "completed order offers 'Write a review'");
    await write.click();
    const form = c.locator("[data-testid=review-form]");
    await form.waitFor();
    await form.locator("button[type=submit]").click();
    await c.waitForSelector("[data-sonner-toast]:has-text('Choose 1 to 5 stars')");
    check(true, "stars are required");
    await form.locator("button[aria-label='4 stars']").click();
    await form.locator("textarea").fill(COMMENT);
    await form.locator("button[type=submit]").click();
    await c.waitForSelector("[data-testid=my-review]:has-text('Waiting for approval')");
    check(sql(`select rating || '|' || status || '|' || display_name from product_reviews where user_id = '${uid}'`) === `4|pending|Selam ${RUN[0]}.`,
      "saved as 4 stars, waiting for approval, shown as first name + initial");
    await anon.reload();
    check(!(await anon.locator("main").innerText()).includes(COMMENT), "not public before approval");

    // ---- admin publishes
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await adminLogin(o, B, OWNER.email, OWNER.password);
    await o.goto(`${B}/admin/reviews`);
    const nav = await o.locator("nav a[href='/admin/reviews']").first().innerText();
    check(/\d/.test(nav), `Reviews has a red badge (${nav.replace(/\s+/g, " ")})`);
    const card = o.locator("li", { hasText: COMMENT });
    check((await card.innerText()).includes(email), "admin sees who wrote it (email) and the order");
    await card.locator("button:has-text('Publish')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Review published')");
    check(sql(`select status from product_reviews where user_id = '${uid}'`) === "approved", "published");
    await anon.goto(`${B}/products/${SLUG}`);
    const page = await anon.locator("main").innerText();
    check(page.includes(COMMENT) && page.includes("Verified purchase"), "published review visible with 'Verified purchase'");
    check(!page.includes(email), "customer's email is never shown");
    check(await anon.locator("a[href='#reviews'] [role=img]").count() === 1, "rating summary under the product name");
    await anon.goto(`${B}/electronics`);
    check(await anon.locator(`article:has(a[href='/products/${SLUG}']) [role=img][aria-label^='Rated']`).count() >= 1, "stars on the product card");

    // ---- edit → pending again; reject with reason → customer sees it
    await c.goto(`${B}/products/${SLUG}`);
    await c.locator("[data-testid=my-review] button:has-text('Edit')").click();
    await c.locator("[data-testid=review-form] button[aria-label='1 star']").click();
    await c.locator("[data-testid=review-form] textarea").fill(`Stopped working ${RUN}`);
    await c.locator("[data-testid=review-form] button[type=submit]").click();
    await c.waitForSelector("[data-testid=my-review]:has-text('Waiting for approval')");
    check(sql(`select status || rating from product_reviews where user_id = '${uid}'`) === "pending1", "edited review goes back for approval");
    await o.goto(`${B}/admin/reviews`);
    const card2 = o.locator("li", { hasText: `Stopped working ${RUN}` });
    await card2.locator("input[name=note]").fill("Please contact us for a warranty replacement");
    await card2.locator("button:has-text('Reject')").click();
    await o.waitForSelector("[data-sonner-toast]:has-text('Review rejected')");
    await c.reload();
    await c.waitForSelector("[data-testid=my-review]:has-text('Not published — Please contact us for a warranty replacement')");
    check(true, "customer sees why it was not published");
    check(sql(`select count(*) from audit_logs where action in ('review_approved','review_rejected') and created_at > now() - interval '5 minutes'`) >= "2", "decisions in the Activity log");
    // ---- delete
    c.on("dialog", (d) => d.accept());
    await c.locator("[data-testid=my-review] button:has-text('Delete')").click();
    await c.waitForSelector("[data-testid=review-form]");
    check(sql(`select count(*) from product_reviews where user_id = '${uid}'`) === "0", "customer can delete their review");
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
