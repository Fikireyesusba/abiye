/** Shared helpers for browser tests: confirmed customer accounts on LOCAL Supabase only. */
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!/127\.0\.0\.1|localhost/.test(SUPA ?? "")) throw new Error("Local Supabase only");

/** Create (or reuse) an email-confirmed, APPROVED customer via the Auth admin API. Returns the user id. */
async function ensureCustomer(email, password, { approved = true } = {}) {
  const headers = { apikey: SECRET, authorization: `Bearer ${SECRET}`, "content-type": "application/json" };
  const res = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: "POST", headers, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "E2E Customer", accepted_terms: "true" } }),
  });
  let id = res.ok ? (await res.json()).id : null;
  if (!id) {
    const list = await (await fetch(`${SUPA}/auth/v1/admin/users?per_page=1000`, { headers })).json();
    const user = list.users.find((u) => u.email === email);
    if (!user) throw new Error(`could not create customer ${email}: ${res.status}`);
    id = user.id;
  }
  // New accounts start "Under verification"; test customers are approved unless a test asks otherwise.
  if (approved) await fetch(`${SUPA}/rest/v1/rpc/approve_invited_customer`, { method: "POST", headers, body: JSON.stringify({ p_user_id: id }) });
  return id;
}

async function loginCustomer(page, base, email, password, next = "/account") {
  await page.goto(`${base}/account/login?next=${encodeURIComponent(next)}`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("form button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/account/login"), { timeout: 15000 });
}

/** Checkout / printing contact fields come from the account (read-only once set): fill only when editable. */
async function fillIfEditable(page, selector, value) {
  const el = page.locator(selector);
  if ((await el.getAttribute("readonly")) === null) await el.fill(value);
}

module.exports = { ensureCustomer, loginCustomer, fillIfEditable };
