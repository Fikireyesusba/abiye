/**
 * Admin dashboard browser test against LOCAL Supabase + app on BASE_URL.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/admin.smoke.cjs
 * Requires the local super admin (owner@abiye.local / ADMIN_E2E_PASSWORD, default LocalDevOwner2026).
 * Mutates the local database. Never point it at production.
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const CHARGER = "20000000-0000-0000-0000-000000000007";

/** Create an order (+ optional payment submission) exactly like the storefront server does. */
function makeOrder(tag, { pay = false, qty = 1 } = {}) {
  const key = sql("select gen_random_uuid()");
  sql(`set role service_role; select public.create_order(jsonb_build_object(
    'idempotency_key','${key}','access_token_hash',encode(sha256('tok-${key}'::bytea),'hex'),'tracking_code_hash',encode(sha256('trk-${key}'::bytea),'hex'),
    'customer',jsonb_build_object('full_name','E2E ${tag}','phone','+2519${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}'),
    'fulfillment',jsonb_build_object('method','delivery','delivery_zone_id','40000000-0000-0000-0000-000000000001','address_line','Bole test'),
    'items',jsonb_build_array(jsonb_build_object('type','product','product_id','${CHARGER}','quantity',${qty}))))`);
  const id = sql(`select id from orders where idempotency_key = '${key}'`);
  if (pay) submit(id, key, `${tag}a`);
  return { id, key, number: sql(`select order_number from orders where id = '${id}'`) };
}
function submit(id, key, suffix) {
  const ref = `FT${RUN}${suffix}`.replace(/[^A-Za-z0-9]/g, "");
  sql(`set role service_role; select public.submit_payment(jsonb_build_object('order_id','${id}','access_token_hash',encode(sha256('tok-${key}'::bytea),'hex'),
    'transaction_reference','${ref}','receipt',jsonb_build_object('path','orders/${id}/${suffix}.png','mime','image/png','size',100,'sha256',encode(sha256('${suffix}${RUN}'::bytea),'hex'))))`);
}

async function login(page, email, password, next = "") {
  await page.goto(`${B}/admin/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 15000 });
}
const submitIn = (page, locator) => locator.locator("button[type=submit]").click();
async function toast(page, text) {
  await page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 15000 });
}

(async () => {
  sql("delete from rate_limits");
  // Leftovers from earlier (possibly aborted) runs must not interfere.
  sql("update profiles set is_active = false where full_name like 'Selam Staff%' or full_name like 'Dawit Manager%'");
  const pngPath = path.join(os.tmpdir(), `p-${RUN}.png`);
  fs.writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const originalHours = sql("select value::text from website_settings where key = 'hours'");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());

  // ---- Auth
  await p.goto(`${B}/admin/settings`);
  check(p.url().includes("/admin/login?next=%2Fadmin%2Fsettings"), "unauthenticated admin page → login with return path");
  await login(p, OWNER.email, OWNER.password, "//evil.example.com");
  check(new URL(p.url()).host === new URL(B).host && new URL(p.url()).pathname === "/admin", "open-redirect in ?next is neutralised");
  check((await p.locator("text=Verified revenue").count()) > 0, "super admin sees revenue");

  // ---- Staff accounts
  await p.goto(`${B}/admin/staff`);
  const addForm = p.locator("form:has(input[name=fullName])");
  const tempPw = async (name, email, role) => {
    await addForm.locator("input[name=fullName]").fill(name);
    await addForm.locator("input[name=email]").fill(email);
    await addForm.locator("select[name=role]").selectOption(role);
    await submitIn(p, addForm);
    const msg = await p.waitForSelector(`[role=status]:has-text("${email}")`);
    return (await msg.textContent()).match(/shown once[^:]*: (\S+)/)[1];
  };
  const staffEmail = `staff-${RUN}@test.local`;
  const staffPw = await tempPw(`Selam Staff ${RUN}`, staffEmail, "staff");
  check(staffPw.length >= 16, "staff account created with one-time temporary password");
  const mgrEmail = `mgr-${RUN}@test.local`;
  const mgrPw = await tempPw(`Dawit Manager ${RUN}`, mgrEmail, "manager");
  const staffId = sql(`select id from auth.users where email = '${staffEmail}'`);
  check(sql(`select r.key from profiles p join admin_roles r on r.id = p.role_id where p.id = '${staffId}'`) === "staff", "profile created with chosen role");

  // ---- Products
  await p.goto(`${B}/admin/products/new`);
  const sku = `E2E-${RUN}`.toUpperCase();
  await p.fill("input[name=name_en]", `E2E Lip Gloss ${RUN}`);
  await p.fill("input[name=name_am]", "የሙከራ ሊፕ ግሎስ");
  await p.fill("input[name=sku]", sku);
  await p.selectOption("select[name=category_id]", { label: "Makeup" });
  await p.fill("input[name=price_etb]", "500");
  await p.fill("input[name=sale_price_etb]", "600");
  await p.fill("input[name=stock_quantity]", "4");
  await submitIn(p, p.locator("form:has(input[name=sku])"));
  await p.waitForSelector("text=Sale price must be lower");
  check(true, "sale price above price is rejected");
  check((await p.inputValue("input[name=sku]")) === sku, "form keeps the admin's input after a validation error");
  await p.fill("input[name=sale_price_etb]", "450");
  await submitIn(p, p.locator("form:has(input[name=sku])"));
  await p.waitForURL(/\/admin\/products\/.+\/edit\?created=1/);
  const productId = p.url().split("/admin/products/")[1].split("/")[0];
  check(sql(`select stock_quantity || '/' || status from products where id = '${productId}'`) === "4/draft", "product created as draft with opening stock");
  await p.setInputFiles("input[aria-label='Upload product images']", pngPath);
  await toast(p, "added");
  await p.waitForSelector("text=MAIN");
  check(sql(`select count(*) from product_images where product_id = '${productId}' and is_primary`) === "1", "uploaded image verified and set as main image");
  await p.selectOption("select[name=status]", "active");
  await submitIn(p, p.locator("form:has(input[name=sku])"));
  await toast(p, "Product saved");
  const slug = sql(`select slug from products where id = '${productId}'`);
  const shop = await ctx.newPage();
  await shop.goto(`${B}/products/${slug}`);
  check((await shop.locator("h1").textContent()).includes(`E2E Lip Gloss ${RUN}`), "activated product appears in the shop");
  check(await shop.locator("main img").first().evaluate((i) => i.complete && i.naturalWidth > 0), "its uploaded image renders in the shop");
  check((await shop.locator("text=450 ETB").count()) > 0, "sale price shown in the shop");

  // ---- Inventory
  await p.goto(`${B}/admin/inventory`);
  const row = p.locator(`tr:has-text("${sku}")`);
  await row.locator("input[name=change]").fill("6");
  await row.locator("select[name=reason]").selectOption("restock");
  await submitIn(p, row);
  await toast(p, "now 10");
  check(sql(`select stock_quantity from products where id = '${productId}'`) === "10", "restock +6 → 10");
  await row.locator("input[name=change]").fill("50");
  await row.locator("select[name=reason]").selectOption("damage");
  await submitIn(p, row);
  await toast(p, "Not enough stock");
  check(sql(`select stock_quantity from products where id = '${productId}'`) === "10", "damage larger than stock refused");
  check(sql(`select count(*) from inventory_movements where product_id = '${productId}'`) === "2", "stock history recorded (opening + restock)");

  // Archive → gone from shop; cannot hard-delete once it has history
  await p.goto(`${B}/admin/products/${productId}/edit`);
  await submitIn(p, p.locator("form:has(button:has-text('Delete permanently'))"));
  await toast(p, "cannot be deleted");
  check(true, "product with stock history cannot be hard-deleted");
  await submitIn(p, p.locator("form:has(button:has-text('Archive product'))"));
  await toast(p, "archived");
  check((await shop.goto(`${B}/products/${slug}`)).status() === 404, "archived product disappears from the shop");

  // ---- Categories
  await p.goto(`${B}/admin/categories`);
  const catForm = p.locator("form").filter({ has: p.locator("button:has-text('Create category')") });
  await catForm.locator("input[name=name_en]").fill(`Nail care ${RUN}`);
  await catForm.locator("input[name=name_am]").fill("የጥፍር እንክብካቤ");
  await catForm.locator("select[name=parent_id]").selectOption({ label: "Cosmetics" });
  await submitIn(p, catForm);
  await toast(p, "Category created");
  check(sql(`select count(*) from categories where name_en = 'Nail care ${RUN}' and department = 'cosmetics'`) === "1", "subcategory created");
  const bad = p.locator("form").filter({ has: p.locator("button:has-text('Create category')") });
  await bad.locator("input[name=name_en]").fill(`Wrong dept ${RUN}`);
  await bad.locator("input[name=name_am]").fill("x");
  await bad.locator("select[name=department]").selectOption("electronics");
  await bad.locator("select[name=parent_id]").selectOption({ label: "Cosmetics" });
  await submitIn(p, bad);
  await toast(p, "parent must be");
  check(true, "subcategory under a different department refused");

  // ---- Payments: reject → resubmit → verify
  const o1 = makeOrder("pay", { pay: true });
  await p.goto(`${B}/admin/payments`);
  const card = p.locator(`li:has-text("${o1.number}")`);
  await submitIn(p, card.locator("form:has(button:has-text('Reject'))"));
  check(sql(`select status from orders where id = '${o1.id}'`) === "pending_verification", "reject without reason is blocked (browser + server)");
  await card.locator("textarea[name=note]").fill("Transfer not found in CBE statement");
  await submitIn(p, card.locator("form:has(button:has-text('Reject'))"));
  await toast(p, "Payment rejected");
  check(sql(`select status || '/' || payment_status from orders where id = '${o1.id}'`) === "payment_rejected/rejected", "payment rejected");
  submit(o1.id, o1.key, "resub");
  await p.goto(`${B}/admin/payments`);
  await submitIn(p, p.locator(`li:has-text("${o1.number}")`).locator("form:has(button:has-text('Verify payment'))"));
  await toast(p, "Payment verified");
  check(sql(`select status || '/' || payment_status from orders where id = '${o1.id}'`) === "confirmed/verified", "payment verified → order confirmed");
  check(sql(`select count(*) from audit_logs where action = 'payment_verified' and actor_id = (select id from auth.users where email = '${OWNER.email}') and metadata->>'order_number' = '${o1.number}'`) === "1",
    "verification audit-logged with the verifier");

  // ---- Fulfillment + assignment + notes
  await p.goto(`${B}/admin/orders/${o1.id}`);
  await p.locator("select[name=assignee]").selectOption(staffId);
  await submitIn(p, p.locator("form:has(select[name=assignee])"));
  await toast(p, "Order assigned");
  await p.fill("textarea[name=body]", "Customer prefers afternoon delivery");
  await submitIn(p, p.locator("form:has(textarea[name=body])"));
  await toast(p, "Note added");

  // ---- Staff session: restricted view
  const sctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const s = await sctx.newPage();
  s.on("dialog", (d) => d.accept());
  await login(s, staffEmail, staffPw);
  const o2 = makeOrder("unassigned");
  await s.goto(`${B}/admin/orders`);
  const staffRows = await s.locator("tbody tr").allTextContents();
  check(staffRows.length === 1 && staffRows[0].includes(o1.number), "staff list shows only their assigned order");
  for (const pathname of ["/admin/products", "/admin/settings", "/admin/payments", "/admin/staff", `/admin/orders/${o2.id}`]) {
    check((await s.goto(B + pathname)).status() === 404, `staff gets 404 on ${pathname.replace(o2.id, "<other order>")}`);
  }
  await s.goto(`${B}/admin/orders`);
  const nav = await s.locator("nav[aria-label=Admin]").textContent();
  check(!nav.includes("Payments") && !nav.includes("Settings"), "staff navigation hides restricted sections");
  await s.goto(`${B}/admin/orders/${o1.id}`);
  check((await s.locator("text=Payment evidence").count()) === 0, "staff cannot see payment receipts");
  check((await s.locator("button:has-text('Cancel order')").count()) === 0, "staff cannot cancel orders");
  await submitIn(s, s.locator("form:has(button:has-text('Start processing'))"));
  await toast(s, "status updated");
  await submitIn(s, s.locator("form:has(button:has-text('Mark out for delivery'))"));
  await toast(s, "status updated");
  check(sql(`select status from orders where id = '${o1.id}'`) === "out_for_delivery", "staff moves assigned order through fulfillment");

  // ---- Manager: no revenue, no bank accounts, no staff
  const mctx = await b.newContext();
  const m = await mctx.newPage();
  m.on("dialog", (d) => d.accept());
  await login(m, mgrEmail, mgrPw);
  check((await m.locator("text=Verified revenue").count()) === 0, "manager does not see revenue");
  check((await m.goto(`${B}/admin/staff`)).status() === 404, "manager cannot open staff management");
  check((await m.goto(`${B}/admin/settings`)).status() === 404, "manager cannot open settings / bank accounts");
  await m.goto(`${B}/admin/orders/${o2.id}`);
  await m.fill("textarea[name=note]", "Customer asked to cancel");
  await m.locator("form:has(button:has-text('Cancel order'))").locator("button").click();
  await m.waitForSelector('[data-sonner-toast]:has-text("status updated")');
  check(sql(`select status from orders where id = '${o2.id}'`) === "cancelled", "manager cancels an order with a reason");
  check(sql(`select coalesce(sum(change),0) from inventory_movements where order_id = '${o2.id}'`) === "0", "cancellation released its stock");

  // ---- Settings (super admin) go live
  await p.goto(`${B}/admin/settings?tab=general`);
  const hours = `Mon–Sat 9:00–19:00 (${RUN})`;
  const hoursForm = p.locator("form:has(input[name=hours_en])");
  await hoursForm.locator("input[name=hours_en]").fill(hours);
  await submitIn(p, hoursForm);
  await toast(p, "Settings saved");
  await shop.goto(`${B}/contact`);
  check((await shop.locator(`text=${hours}`).count()) > 0, "opening hours change is live on the shop");

  await p.goto(`${B}/admin/settings?tab=delivery`);
  const delForm = p.locator("form:has(input[name=payment_window_hours])");
  await delForm.locator("input[name=delivery_enabled]").uncheck();
  await delForm.locator("input[name=pickup_enabled]").uncheck();
  await submitIn(p, delForm);
  await toast(p, "at least one");
  check(true, "cannot disable both delivery and pickup");
  const add = p.locator("form").filter({ has: p.locator("button:has-text('Add city')") });
  await add.locator("input[name=name_en]").fill(`Dire Dawa ${RUN}`);
  await add.locator("input[name=name_am]").fill("ድሬዳዋ");
  await add.locator("input[name=fee_etb]").fill("600");
  await submitIn(p, add);
  await toast(p, "Delivery zone saved");
  check(sql(`select fee_etb from delivery_zones where name_en = 'Dire Dawa ${RUN}'`) === "600.00", "delivery city added");

  // Bank change: new orders use it, old orders keep their snapshot
  const oldNumber = sql(`select bank_snapshot->>'account_number' from orders where id = '${o1.id}'`);
  const auditBefore = Number(sql(`select count(*) from audit_logs where entity_type = 'bank_accounts' and action = 'update'`));
  await p.goto(`${B}/admin/settings?tab=banks`);
  const bankForm = p.locator("form:has(input[value='1000000000000'])");
  await bankForm.locator("input[name=account_number]").fill("1000123456789");
  await submitIn(p, bankForm);
  await toast(p, "Bank account saved");
  const o3 = makeOrder("newbank");
  check(sql(`select bank_snapshot->>'account_number' from orders where id = '${o3.id}'`) === "1000123456789", "new order shows the updated bank account");
  check(sql(`select bank_snapshot->>'account_number' from orders where id = '${o1.id}'`) === oldNumber, "existing order keeps its original bank details");
  check(Number(sql(`select count(*) from audit_logs where entity_type = 'bank_accounts' and action = 'update'`)) === auditBefore + 1
    && sql(`select after_data->>'account_number' from audit_logs where entity_type = 'bank_accounts' order by id desc limit 1`) === "1000123456789",
    "bank change audit-logged");
  // restore sample bank number for other tests
  sql(`update bank_accounts set account_number = '1000000000000' where account_number = '1000123456789'`);

  // ---- Deactivate staff → immediate loss of access
  await p.goto(`${B}/admin/staff`);
  const srow = p.locator(`tr:has-text("${staffEmail}")`);
  await srow.locator("select[name=active]").selectOption("false");
  await submitIn(p, srow.locator("form:has(select[name=active])"));
  await toast(p, "Access removed");
  const after = await s.goto(`${B}/admin/orders`);
  check(s.url().includes("/admin/login"), `deactivated staff lose access on their very next request (${after.status()})`);
  check(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${staffId}","role":"authenticated"}', false); select count(*) from orders;`) === "0",
    "deactivated staff's still-valid token reads no orders (RLS)");

  // Super admin cannot demote themselves
  check((await p.locator(`tr:has-text("${OWNER.email}") select[name=role]`).count()) === 0, "own row has no role controls (no self-demotion)");

  // ---- Phone-width layout of every admin page
  const phone = await b.newContext({ viewport: { width: 390, height: 844 } });
  await phone.addCookies(await ctx.cookies());
  const ph = await phone.newPage();
  const wide = [];
  for (const pathname of ["/admin", "/admin/orders", `/admin/orders/${o1.id}`, "/admin/payments", "/admin/products", `/admin/products/${productId}/edit`,
    "/admin/categories", "/admin/inventory", "/admin/customers", "/admin/staff", "/admin/settings", "/admin/settings?tab=banks", "/admin/settings?tab=delivery", "/admin/account"]) {
    await ph.goto(B + pathname);
    if (await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) wide.push(pathname);
  }
  check(wide.length === 0, `no horizontal page overflow at 390px (${wide.join(", ")})`);

  // ---- Logout
  await p.locator("button[aria-label='Sign out']").click();
  await p.waitForURL(/\/admin\/login/);
  check((await p.goto(`${B}/admin`)) && p.url().includes("/admin/login"), "signed out");

  // Restore shared local data so the other smoke suites see the seeded shop.
  sql(`update website_settings set value = '${originalHours.replace(/'/g, "''")}'::jsonb where key = 'hours'`);
  sql(`update delivery_zones set is_active = false where name_en like 'Dire Dawa %'`);
  sql(`update categories set is_active = false where name_en like 'Nail care %' or name_en like 'Wrong dept %'`);

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  console.log(results.join("\n"));
  await b.close();
  fs.rmSync(pngPath);
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})().catch((e) => {
  console.log(results.join("\n"));
  console.error(e);
  process.exit(1);
});
