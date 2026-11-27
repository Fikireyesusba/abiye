/**
 * Grafana metrics link /api/metrics: exists only with METRICS_TOKEN; Bearer or Basic auth; Prometheus text; numbers only.
 * Starts its own server with a test token.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/metrics.smoke.cjs
 */
const { spawn, execSync } = require("child_process");
const PORT = 3109;
const TOKEN = "test-metrics-token-0123456789abcdefghijkl";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = `http://127.0.0.1:${PORT}/api/metrics`;

(async () => {
  sql("delete from rate_limits where key like 'metrics%'");
  check((await fetch("http://localhost:3100/api/metrics").catch(() => ({ status: 0 }))).status === 404, "without METRICS_TOKEN the link does not exist (404)");
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], { env: { ...process.env, METRICS_TOKEN: TOKEN }, stdio: "ignore", detached: true });
  try {
    for (let i = 0; i < 60; i++) { if ((await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null))?.ok) break; await sleep(500); }
    check((await fetch(U)).status === 401, "no token: refused (401)");
    check((await fetch(U, { headers: { authorization: "Bearer wrong-token-wrong-token-wrong-token-xx" } })).status === 401, "wrong token: refused");
    const r = await fetch(U, { headers: { authorization: `Bearer ${TOKEN}` } });
    const text = await r.text();
    check(r.status === 200 && /text\/plain/.test(r.headers.get("content-type") ?? "") && r.headers.get("cache-control") === "no-store", "Bearer token: 200, Prometheus text, not cached");
    const pending = sql("select count(*) from payment_submissions where status = 'pending'");
    check(text.includes("abiye_up 1") && text.includes(`abiye_payments_pending ${pending}`) && /abiye_deliveries\{stage="waiting_courier"\} \d+/.test(text),
      "metrics match the database (payments waiting, deliveries…)");
    check(text.split("\n").filter((l) => l && !l.startsWith("#")).every((l) => /^abiye_[a-z0-9_]+(\{[a-z_]+="[A-Za-z0-9_-]+"\})? -?\d+(\.\d+)?$/.test(l)), "numbers only — no names, phones or emails");
    const basic = await fetch(U, { headers: { authorization: `Basic ${Buffer.from(`grafana:${TOKEN}`).toString("base64")}` } });
    check(basic.status === 200, "Basic auth (Grafana Cloud: any user name, token as password) works");
    const anon = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/metrics_snapshot`, {
      method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: "{}" });
    check(anon.status >= 400, `the database function cannot be called from the browser (${anon.status})`);
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    try { process.kill(-app.pid, "SIGTERM"); } catch {}
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
