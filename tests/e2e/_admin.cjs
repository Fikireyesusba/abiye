/**
 * Admin sign-in for browser tests, including the two-step login.
 * Generates authenticator (TOTP, RFC 6238) codes exactly like a phone app.
 * First sign-in of an account sets up the authenticator; the secret is kept in
 * a temp file so later runs reuse it. LOCAL Supabase only.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Local Supabase only");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STORE = path.join(os.tmpdir(), "abiye-e2e-totp.json");
const load = () => { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; } };
const save = (s) => fs.writeFileSync(STORE, JSON.stringify(s));

function base32(secret) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
function totp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
/** A fresh code; never reuses the time window of this account's previous code. */
async function nextCode(email, secret) {
  const s = load();
  let counter = Math.floor(Date.now() / 30000);
  if (s[`${email}:last`] >= counter) {
    await new Promise((r) => setTimeout(r, (counter + 1) * 30000 - Date.now() + 500));
    counter = Math.floor(Date.now() / 30000);
  }
  save({ ...load(), [`${email}:last`]: counter });
  return totp(secret, counter);
}

/** Remove an account's authenticator (forces set-up at next sign-in). */
function resetFactors(email) {
  execSync(`psql -Atq "${DB}"`, { input: `delete from auth.mfa_factors where user_id = (select id from auth.users where email = '${email.replace(/'/g, "''")}')` });
  const s = load();
  delete s[email];
  save(s);
}

/** Password + authenticator code. Ends on the page after sign-in. */
async function adminLogin(page, base, email, password, next = "") {
  await page.goto(`${base}/admin/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 15000 });
  await passMfa(page, email);
}

async function passMfa(page, email) {
  if (!new URL(page.url()).pathname.startsWith("/admin/mfa")) return;
  let secret = load()[email];
  if (await page.locator("#code").count() && !secret) {
    // Verified authenticator from an earlier run whose secret is unknown: start over.
    resetFactors(email);
    await page.reload();
  }
  if (await page.locator("button:has-text('Set up two-step login')").count()) {
    await page.click("button:has-text('Set up two-step login')");
    await page.click("summary:has-text('Enter this key instead')");
    secret = (await page.locator("p.select-all").textContent()).trim();
    save({ ...load(), [email]: secret });
  }
  await page.fill("#code", await nextCode(email, secret));
  await page.click("form button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/mfa"), { timeout: 15000 });
}

module.exports = { adminLogin, passMfa, nextCode, resetFactors, totp };
