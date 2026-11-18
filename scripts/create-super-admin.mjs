#!/usr/bin/env node
/**
 * Create the FIRST Super Admin. Works only while no active Super Admin exists
 * (enforced in the database by public.bootstrap_super_admin).
 *
 *   node --env-file=.env.local scripts/create-super-admin.mjs --email owner@abiye.com --name "Owner Name"
 *
 * Password: taken from ADMIN_PASSWORD if set, otherwise asked interactively
 * (hidden), otherwise (non-interactive) a strong one is generated and printed ONCE.
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY. Never commit them.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import readline from "node:readline";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
  console.error('Usage: create-super-admin.mjs --email you@example.com --name "Full Name"');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. --env-file=.env.local).");
  process.exit(1);
}

const strong = (p) => p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : "");
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

let password = process.env.ADMIN_PASSWORD;
let generated = false;
if (!password && process.stdin.isTTY) {
  password = await askHidden("Password (min 12 chars, upper, lower, digit): ");
  const again = await askHidden("Repeat password: ");
  if (password !== again) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
}
if (!password) {
  password = `${randomBytes(18).toString("base64url")}Aa1`;
  generated = true;
}
if (!strong(password)) {
  console.error("Password too weak: use at least 12 characters with upper-case, lower-case letters and a digit.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: created, error: createError } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (createError) {
  console.error(`Could not create user: ${createError.message}`);
  process.exit(1);
}
const { error } = await db.rpc("bootstrap_super_admin", { p_user_id: created.user.id, p_full_name: name });
if (error) {
  await db.auth.admin.deleteUser(created.user.id); // do not leave an orphan account behind
  console.error(error.message === "super_admin_exists"
    ? "A Super Admin already exists. Add more staff from /admin/staff instead."
    : `Bootstrap failed: ${error.message}`);
  process.exit(1);
}
console.log(`✓ Super Admin created: ${email}`);
if (generated) console.log(`  Temporary password (shown once): ${password}\n  Sign in at /admin/login and change it under "My account".`);
