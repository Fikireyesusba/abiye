/**
 * Documents & vehicles: Super Admin adds a vehicle, uploads documents for an employee and the vehicle (private, virus-scanned),
 * opens them through a short-lived link, sees what expires, deletes; other staff cannot open the section.
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules node --env-file=.env.local tests/e2e/documents.smoke.cjs
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { adminLogin } = require("./_admin.cjs");
const { ensureCustomer } = require("./_customer.cjs");

const B = process.env.BASE_URL ?? "http://localhost:3100";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OWNER = { email: "owner@abiye.local", password: process.env.ADMIN_E2E_PASSWORD ?? "LocalDevOwner2026" };
const sql = (q) => execSync(`psql -Atq -v ON_ERROR_STOP=1 "${DB}"`, { input: q }).toString().trim().split("\n").pop() ?? "";
const results = [];
const check = (ok, msg) => results.push(`${ok ? "ok  " : "FAIL"} - ${msg}`);
const RUN = Date.now().toString(36);
const toast = (page, text) => page.waitForSelector(`[data-sonner-toast]:has-text("${text}")`, { timeout: 20000 });

(async () => {
  sql("delete from rate_limits");
  const email = `docstaff-${RUN}@example.com`;
  const sid = await ensureCustomer(email, "DocStaffE2E2026x");
  sql(`insert into profiles (id, full_name, role_id) select '${sid}', 'Doc Staff ${RUN}', id from admin_roles where key = 'staff'`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  const pdf = path.join(dir, "licence.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const fake = path.join(dir, "fake.pdf");
  fs.writeFileSync(fake, "MZ this is not a pdf at all, just text pretending");
  const plate = `AA ${RUN.slice(-5).toUpperCase()}`;
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

  const b = await chromium.launch();
  try {
    const o = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await adminLogin(o, B, OWNER.email, OWNER.password);
    // vehicle
    await o.goto(`${B}/admin/documents?tab=add`);
    await o.selectOption("select[name=kind]", "motorcycle");
    await o.fill("input[name=plate_number]", plate);
    await o.fill("input[name=make]", "Bajaj");
    await o.fill("input[name=insurance_expiry]", soon);
    await o.click("button:has-text('Add vehicle')");
    await o.waitForURL(/\/admin\/documents\/vehicles\/[0-9a-f-]{36}\?created=1/, { timeout: 15000 });
    const vid = new URL(o.url()).pathname.split("/").pop();
    check(sql(`select plate_number || ' ' || insurance_expiry from vehicles where id = '${vid}'`) === `${plate} ${soon}`, "Super Admin adds a motorcycle (plate, insurance expiry)");
    // vehicle document
    await o.selectOption("select[name=kind]", "libre");
    await o.fill("input[name=title]", "Libre scan");
    await o.setInputFiles("input[name=file]", pdf);
    await o.click("button:has-text('Upload document')");
    await toast(o, "Document saved");
    check(sql(`select count(*) from documents where vehicle_id = '${vid}'`) === "1", "vehicle document uploaded");
    // employee documents: wrong type refused, PDF accepted, link opens
    await o.goto(`${B}/admin/documents/staff/${sid}`);
    await o.selectOption("select[name=kind]", "driving_licence");
    await o.fill("input[name=title]", "Licence");
    await o.setInputFiles("input[name=file]", fake);
    await o.click("button:has-text('Upload document')");
    await toast(o, "Only PDF, JPG, PNG or WEBP");
    check(true, "a file that is not really a PDF / image is refused (checked by content)");
    await o.setInputFiles("input[name=file]", pdf);
    await o.fill("input[name=expires_on]", soon);
    await o.click("button:has-text('Upload document')");
    await toast(o, "Document saved");
    const file = sql(`select file_path from documents where profile_id = '${sid}'`);
    check(/^staff\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(file) && sql(`select count(*) from upload_scans where source = 'staff_document' and created_at > now() - interval '5 minutes'`) >= "2",
      "stored under a server-made name, virus scan recorded");
    const href = await o.locator("[data-testid=document-list] a", { hasText: "Licence" }).getAttribute("href");
    const res = await o.request.get(href);
    check(res.status() === 200 && (await res.body()).toString().startsWith("%PDF"), "the document opens through a short-lived private link");
    const anon = await (await b.newContext()).newPage();
    const pub = await anon.request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/staff-documents/${file}`);
    check(pub.status() >= 400, `no public access to the file (${pub.status()})`);
    // expiring
    await o.goto(`${B}/admin/documents?tab=expiring`);
    const exp = await o.locator("[data-testid=expiring-list]").innerText();
    check(exp.includes("Licence") && exp.includes(plate), "Expiring: the licence and the motorcycle insurance");
    // yellow "action needed" markers: menu + dashboard
    await o.goto(`${B}/admin`);
    const nav = o.locator('aside a[href="/admin/documents"]');
    check(await nav.getAttribute("data-action-needed") === "true" && (await nav.locator("[data-badge-tone=yellow]").count()) === 1
      && /expiring — action needed/.test(await nav.getAttribute("title") ?? ""), "menu: Documents & vehicles marked yellow with the count (action needed)");
    check((await o.locator("[data-testid=needs-action]").innerText()).includes("documents / licences / insurance expiring"), "dashboard: yellow “Needs your action” box lists it");
    // delete
    await o.goto(`${B}/admin/documents/staff/${sid}`);
    o.on("dialog", (d) => d.accept());
    await o.locator("[data-testid=document-list] li", { hasText: "Licence" }).locator("button:has-text('Delete')").click();
    await toast(o, "Document deleted");
    check(sql(`select count(*) from documents where profile_id = '${sid}'`) === "0" && sql(`select count(*) from storage.objects where name = '${file}'`) === "0",
      "deleted: the record and the file");
    // Grafana switch (Admin → Notifications): on and off again
    await o.goto(`${B}/admin/notifications?tab=telegram`);
    await o.check("[data-testid=grafana-alerts-toggle]");
    await o.locator("form:has([data-testid=grafana-alerts-toggle]) button[type=submit]").click();
    await toast(o, "Monitoring alerts now come from Grafana");
    check(sql("select value->>'grafana_alerts' from website_settings where key = 'monitoring'") === "true", "switch: monitoring alerts handed to Grafana");
    await o.uncheck("[data-testid=grafana-alerts-toggle]");
    await o.locator("form:has([data-testid=grafana-alerts-toggle]) button[type=submit]").click();
    await toast(o, "The website sends its monitoring alerts again");
    // other staff cannot open the section
    const s = await (await b.newContext()).newPage();
    await adminLogin(s, B, email, "DocStaffE2E2026x");
    check((await s.goto(`${B}/admin/documents`)).status() === 404, "staff without the permission cannot open Documents & vehicles");
  } catch (e) {
    check(false, `crashed: ${e.message.split("\n")[0]}`);
  } finally {
    await b.close();
    sql(`update profiles set is_active = false where id = '${sid}'`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
