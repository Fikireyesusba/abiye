/**
 * Customer accounts, sign-in-to-order, editable terms, bank & social info.
 * LOCAL Supabase (with the mail catcher on :54324) + app on BASE_URL.
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local tests/e2e/account.smoke.cjs
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

/** Latest email to `to` (Mailpit), returning the /auth/confirm link inside it. */
async function emailLink(to, subjectPart) {
  for (let i = 0; i < 40; i++) {
    const found = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    const msg = (found.messages ?? []).find((m) => m.Subject.includes(subjectPart));
    if (msg) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${msg.ID}`)).json();
      const href = full.HTML.match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1];
      if (href) return href.replace(/&amp;/g, "&");
    }
    await sleep(500);
  }
  throw new Error(`no "${subjectPart}" email for ${to}`);
}

(async () => {
  sql("delete from rate_limits; update products set stock_quantity = 80 where sku = 'SMP-CH-001'");
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));

  // ---- 1. Ordering requires an account
  await p.goto(`${B}/checkout`);
  check(p.url().includes("/account/login?next=%2Fcheckout"), "signed-out visitor sent from /checkout to sign-in");
  check((await p.locator("text=Sign in or create an account to place an order").count()) === 1, "sign-in page explains why");
  await p.goto(`${B}/printing`);
  check((await p.locator("#print-files").count()) === 0 && (await p.locator("text=Sign in or create an account to order printing").count()) === 1,
    "printing form hidden until signed in (price list still public)");
  check((await p.locator("table").count()) === 1, "printing price list still visible");

  // ---- 2. Sign up → email confirmation
  const email = `buyer-${RUN}@example.com`;
  await p.goto(`${B}/account/signup?next=/checkout`);
  await p.fill("#fullName", "Selamawit Tadesse");
  await p.fill("#email", email);
  await p.fill("#password", "weak");
  await p.fill("#confirm", "weak");
  await p.check("input[name=acceptTerms]");
  await p.locator("form button[type=submit]").evaluate((btn) => btn.closest("form").noValidate = true);
  await p.click("form button[type=submit]");
  await p.waitForSelector("[role=alert]:has-text('8 characters')");
  check(true, "weak password rejected by the server");
  await p.fill("#password", "Selam2026pass");
  await p.fill("#confirm", "Selam2026pass");
  await p.uncheck("input[name=acceptTerms]");
  await p.click("form button[type=submit]");
  await p.waitForSelector("[role=alert]:has-text('accept the terms')");
  check(true, "sign-up requires accepting the terms");
  // only Gmail addresses (local tests also allow example / test domains)
  await p.fill("#email", `buyer-${RUN}@outlook.com`);
  await p.fill("#password", "Selam2026pass");
  await p.fill("#confirm", "Selam2026pass");
  await p.check("input[name=acceptTerms]");
  await p.click("form button[type=submit]");
  await p.waitForSelector("[role=alert]:has-text('Gmail')");
  check(sql(`select count(*) from auth.users where email = 'buyer-${RUN}@outlook.com'`) === "0", "non-Gmail address refused at sign-up");
  await p.fill("#email", email);
  await p.uncheck("input[name=acceptTerms]");
  await p.fill("#password", "Selam2026pass"); // password fields are cleared after an error (by design)
  await p.fill("#confirm", "Selam2026pass");
  await p.check("input[name=acceptTerms]");
  await p.click("form button[type=submit]");
  await p.waitForSelector("text=Check your email");
  check(true, "sign-up asks the customer to confirm their email");
  check(sql(`select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email = '${email}'`) === "0", "signing up grants no admin access");

  await p.goto(`${B}/account/login`);
  await p.fill("#email", email);
  await p.fill("#password", "Selam2026pass");
  await p.click("form button[type=submit]");
  await p.waitForSelector("[role=alert]:has-text('confirm your email')");
  check(true, "cannot sign in before confirming the email");

  const link = await emailLink(email, "Confirm your Abiye account");
  check(link.startsWith(`${B}/auth/confirm?token_hash=`), "confirmation email contains a working link");
  const other = await (await b.newContext()).newPage(); // opened "on another device"
  await other.goto(link);
  await other.waitForURL(/\/account\?welcome=1/);
  check((await other.locator("text=Your email is confirmed").count()) === 1, "link confirms the email and signs in (works on any device)");
  check(sql(`select full_name || '|' || (accepted_terms_at is not null) from customer_accounts c join auth.users u on u.id = c.id where u.email = '${email}'`) === "Selamawit Tadesse|true",
    "account created with name and recorded terms acceptance");
  check((await (await b.newContext()).newPage().then(async (x) => { await x.goto(link); return x.url(); })).includes("/account/login?error=link"),
    "a confirmation link cannot be reused");

  // ---- 3. Sign in and order (terms required, details remembered)
  await loginCustomer(p, B, email, "Selam2026pass", "/checkout");
  await p.goto(B);
  await p.evaluate(() => {
    localStorage.setItem("cart:v1", JSON.stringify([{ type: "product", productId: "20000000-0000-0000-0000-000000000007", quantity: 1 }]));
    localStorage.setItem("checkout:prefs:v1", JSON.stringify({ method: "pickup", deliveryZoneId: null }));
  });
  await p.goto(`${B}/checkout`);
  await p.waitForSelector("text=Order summary");
  check((await p.inputValue("#fullName")) === "Selamawit Tadesse", "checkout prefilled with the account name");
  check((await p.locator(`text=Ordering as ${email}`).count()) === 1, "checkout shows which account is ordering");
  await p.fill("#phone", "0911 23 45 67");
  check(await p.locator("button[type=submit]:has-text('Place order')").isDisabled(), "Place order disabled until terms are accepted");
  await p.check("label:has-text('I agree') input[type=checkbox]");
  await p.click("button[type=submit]:has-text('Place order')");
  await p.waitForURL(/order-success/);
  const orderId = p.url().split("/order-success/")[1];
  const userId = sql(`select id from auth.users where email = '${email}'`);
  check(sql(`select user_id from orders where id = '${orderId}'`) === userId, "order is linked to the customer's account");
  check(sql(`select phone from customer_accounts where id = '${userId}'`) === "+251911234567", "phone saved to the account for next time");

  // ---- 4. My account: orders, owner access from another device, isolation
  await p.goto(`${B}/account`);
  check((await p.locator('a[href="/account/orders"]').count()) === 1, "My account links to My orders");
  await p.click('a[href="/account/orders"]');
  await p.waitForURL(/\/account\/orders$/);
  check((await p.locator(`a[href="/order-success/${orderId}"]`).count()) === 1, "My orders lists the order (tap to open)");
  const dev2 = await (await b.newContext()).newPage();
  await loginCustomer(dev2, B, email, "Selam2026pass");
  await dev2.goto(`${B}/order-success/${orderId}`);
  check((await dev2.locator("text=Pay by bank transfer").count()) === 1 && (await dev2.locator("#receipt").count()) === 1,
    "owner opens their order and can pay from another device (no private link needed)");
  await dev2.goto(`${B}/contact`);
  check(!new URL(dev2.url()).pathname.startsWith("/account/login") && (await dev2.locator("[data-testid=footer-links]").count()) === 0,
    "signed-in customer: no Help / Contact in the footer (they are in the profile menu)");
  const strangerEmail = `stranger-${RUN}@example.com`;
  await ensureCustomer(strangerEmail, "Stranger2026x");
  const stranger = await (await b.newContext()).newPage();
  await loginCustomer(stranger, B, strangerEmail, "Stranger2026x");
  await stranger.goto(`${B}/order-success/${orderId}`);
  check((await stranger.locator("text=different account").count()) === 1 && (await stranger.locator("#receipt").count()) === 0, "another customer cannot open someone else's order (told it belongs to another account)");
  await stranger.goto(`${B}/account`);
  check((await stranger.locator(`a[href="/order-success/${orderId}"]`).count()) === 0, "another customer's account does not list it");
  await stranger.goto(`${B}/admin/login`);
  await stranger.fill("#email", strangerEmail);
  await stranger.fill("#password", "Stranger2026x");
  await stranger.click("button[type=submit]");
  await stranger.waitForSelector("[role=alert]:has-text('does not have access')");
  check(true, "customer accounts cannot sign in to the admin dashboard");

  // ---- 5. Forgot / reset password
  const r = await (await b.newContext()).newPage();
  await r.goto(`${B}/account/forgot-password`);
  await r.fill("#email", email);
  await r.click("form button[type=submit]");
  await r.waitForSelector("text=a reset link is on its way");
  const resetLink = await emailLink(email, "Reset your Abiye password");
  await r.goto(resetLink);
  await r.waitForURL(/\/account\/reset-password/);
  await r.fill("#password", "NewSelam2027pass");
  await r.fill("#confirm", "NewSelam2027pass");
  await r.click("form button[type=submit]");
  await r.waitForURL(/passwordChanged=1/);
  check(true, "password reset via emailed link");
  const r2 = await (await b.newContext()).newPage();
  await r2.goto(`${B}/account/login`);
  await r2.fill("#email", email);
  await r2.fill("#password", "Selam2026pass");
  await r2.click("form button[type=submit]");
  await r2.waitForSelector("[role=alert]:has-text('Incorrect')");
  await loginCustomer(r2, B, email, "NewSelam2027pass");
  check(true, "old password no longer works; new one does");
  await r2.goto(`${B}/account/forgot-password`);
  await r2.fill("#email", `nobody-${RUN}@example.com`);
  await r2.click("form button[type=submit]");
  await r2.waitForSelector("text=a reset link is on its way");
  check(true, "unknown email gets the same answer (no account enumeration)");

  // ---- 5b. Invitation (Supabase dashboard "Send invitation") → choose a password
  const invitee = `invitee-${RUN}@example.com`;
  const inv = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/invite`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email: invitee }),
  });
  check(inv.ok, `invitation sent (${inv.status})`);
  const invMsg = await (async () => {
    for (let i = 0; i < 40; i++) {
      const found = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${invitee}"`)}`)).json();
      if (found.messages?.length) return (await fetch(`${MAIL}/api/v1/message/${found.messages[0].ID}`)).json();
      await sleep(500);
    }
  })();
  check(invMsg?.HTML.includes("You've been invited to Abiye") && !/[\u1200-\u137F]/.test(invMsg.HTML), "invitation email is in English only");
  const invLink = invMsg.HTML.match(/href="([^"]*\/auth\/confirm[^"]*type=invite[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
  const ip = await (await b.newContext()).newPage();
  await ip.goto(invLink);
  await ip.waitForURL(/\/account\/reset-password/);
  await ip.fill("#password", "Invited2026pass");
  await ip.fill("#confirm", "Invited2026pass");
  await ip.click("form button[type=submit]");
  await ip.waitForURL(/\/account\?passwordChanged=1/);
  check(true, "invitation link lets the person choose a password and signs them in");
  check(sql(`select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email = '${invitee}'`) === "0",
    "an invitation does not grant admin access");

  // ---- 6. Admin manages contact, social, terms → visible to customers
  const a = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await adminLogin(a, B, OWNER.email, OWNER.password);
  // Customers page lists registered accounts (even without orders), incl. unconfirmed sign-ups
  const pending = `pending-${RUN}@example.com`;
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: pending, password: "Pending2026x", data: { full_name: "Pending Person" } }),
  });
  await a.goto(`${B}/admin/customers?q=${encodeURIComponent(pending)}`);
  const midOf = (e) => sql(`select a.member_id from customer_accounts a join auth.users u on u.id = a.id where u.email = '${e}'`);
  check((await a.locator(`tr:has-text("${midOf(pending)}"):has-text("Not confirmed")`).count()) === 1 && (await a.locator(`text=${pending}`).count()) === 0, "new sign-up without orders appears under Customers as 'Not confirmed'");
  await a.goto(`${B}/admin/customers?q=${encodeURIComponent(strangerEmail)}`);
  check((await a.locator(`tr:has-text("${midOf(strangerEmail)}"):has-text("Confirmed")`).count()) === 1, "confirmed account with no orders is listed");
  await a.goto(`${B}/admin/customers?q=${encodeURIComponent(email)}`);
  await a.locator(`tr:has-text("${midOf(email)}") a`).first().click();
  await a.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/);
  const emailShown = (await a.locator(`text=${email}`).count()) >= 1;
  await a.click("nav[aria-label=Sections] a:has-text('Orders')");
  await a.waitForURL(/tab=orders/);
  check((await a.locator(`a[href="/admin/orders/${orderId}"]`).count()) === 1 && emailShown,
    "customer page shows their email and orders");

  const original = sql("select json_build_object('contact', (select value from website_settings where key='contact'), 'social', (select value from website_settings where key='social'), 'legal', (select value from website_settings where key='legal'))::text");
  await a.goto(`${B}/admin/settings?tab=contact`);
  const contact = a.locator("form:has(input[name=whatsapp])");
  await contact.locator("input[name=phone]").fill("0911 00 11 22");
  await contact.locator("input[name=email]").fill("abiyeshop@gmail.com");
  await contact.locator("input[name=whatsapp]").fill("0911 00 11 22");
  await contact.locator("input[name=telegram]").fill("abiyeshop");
  await contact.locator("button[type=submit]").click();
  await a.waitForSelector('[data-sonner-toast]:has-text("Settings saved")');
  await a.goto(`${B}/admin/settings?tab=social`);
  const social = a.locator("form:has(input[name=instagram])");
  await social.locator("input[name=instagram]").fill("https://instagram.com/abiyeshop");
  await social.locator("input[name=tiktok]").fill("https://www.tiktok.com/@abiyeshop");
  await social.locator("input[name=facebook]").fill("https://facebook.com/abiyeshop");
  await social.locator("input[name=telegram]").fill("javascript:alert(1)");
  await social.locator("button[type=submit]").click();
  await a.waitForSelector('[data-sonner-toast]:has-text("Check")');
  check(true, "non-https social link refused");
  await social.locator("input[name=telegram]").fill("https://t.me/abiyeshop");
  await social.locator("button[type=submit]").click();
  // Don't rely on the toast (an earlier "Settings saved" may still be visible): wait for the data.
  for (let i = 0; i < 40 && sql("select value->>'instagram' from website_settings where key = 'social'") !== "https://instagram.com/abiyeshop"; i++) await sleep(250);

  await p.goto(`${B}/contact`);
  for (const [label, href] of [["Instagram", "https://instagram.com/abiyeshop"], ["TikTok", "https://www.tiktok.com/@abiyeshop"], ["Facebook", "https://facebook.com/abiyeshop"],
    ["Telegram", "https://t.me/abiyeshop"], ["Email", "mailto:abiyeshop@gmail.com"], ["WhatsApp", "https://wa.me/251911001122"], ["Phone", "tel:+251911001122"]]) {
    check((await p.locator(`main a[href="${href}"]`).count()) === 1, `contact page links ${label}`);
  }
  check((await p.locator("main:has-text('How to pay')").count()) === 1 && (await p.locator("main >> text=1000000000000").count()) === 1,
    "contact page shows the bank account to pay into");
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.locator("main button[aria-label*='Account number']").first().click();
  check((await p.evaluate(() => navigator.clipboard.readText())) === "1000000000000", "bank account number copy button");
  check((await p.locator("footer >> text=1000000000000").count()) === 0, "footer no longer shows bank details (only the contact page and checkout do)");

  await a.goto(`${B}/admin/settings?tab=legal`);
  const legal = a.locator("form:has(textarea[name=terms_en])");
  const termsEn = await legal.locator("textarea[name=terms_en]").inputValue();
  await legal.locator("textarea[name=terms_en]").fill(`${termsEn}\n\n## Exchanges ${RUN}\n\nItems can be exchanged within 3 days with the receipt. <script>alert(1)</script>`);
  await legal.locator("input[name=approved]").check();
  await legal.locator("button[type=submit]").click();
  await a.waitForSelector('[data-sonner-toast]:has-text("Settings saved")');
  await p.goto(`${B}/terms`);
  check((await p.locator(`h2:text("Exchanges ${RUN}")`).count()) === 1, "terms edited in admin appear on the website");
  check((await p.locator("text=<script>alert(1)</script>").count()) === 1 && !(await p.content()).includes("<script>alert(1)</script>"),
    "admin-entered markup shown as text, never executed");
  check((await p.locator("text=Draft — to be reviewed").count()) === 0, "approved terms no longer show the draft notice");
  await p.goto(`${B}/privacy`);
  check((await p.locator("h2").count()) >= 5, "privacy policy rendered from settings");

  // restore shared settings
  sql(`with o as (select '${original.replace(/'/g, "''")}'::json j)
       update website_settings w set value = (select (j -> w.key)::jsonb from o) where key in ('contact','social','legal')`);

  // ---- 7. Phone layout
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const wide = [];
  for (const path of ["/account/login", "/account/signup", "/contact", "/terms"]) {
    await m.goto(B + path);
    if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(path);
  }
  check(wide.length === 0, `no horizontal overflow on phones (${wide.join(", ")})`);

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  console.log(results.join("\n"));
  await b.close();
  if (results.some((x) => x.startsWith("FAIL"))) process.exit(1);
})().catch((e) => {
  console.log(results.join("\n"));
  console.error(e);
  process.exit(1);
});
