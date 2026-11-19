import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, parseAdminContext } from "@/lib/auth/permissions";
import { APP_ERROR_CODES } from "@/lib/errors";
import en from "../../messages/en.json";
import am from "../../messages/am.json";

const root = join(__dirname, "../..");
const sql = readdirSync(join(root, "supabase/migrations"))
  .sort()
  .map((f) => readFileSync(join(root, "supabase/migrations", f), "utf8"))
  .join("\n");

const keysOf = (o: object, prefix = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

describe("TypeScript ↔ SQL consistency", () => {
  it("permission list matches public.admin_permissions", () => {
    const block = sql.split("insert into public.admin_permissions")[1].split(";")[0];
    const dbPerms = [...block.matchAll(/\('([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...PERMISSIONS].sort()).toEqual(dbPerms);
  });

  it("every app_error code raised in SQL is known to the app and translated", () => {
    const raised = new Set([...sql.matchAll(/app_error\('([a-z_]+)'/g)].map((m) => m[1]));
    for (const code of raised) {
      expect(APP_ERROR_CODES, `missing code ${code}`).toContain(code);
    }
    for (const code of APP_ERROR_CODES) {
      expect(en.errors, `en missing errors.${code}`).toHaveProperty(code);
      expect(am.errors, `am missing errors.${code}`).toHaveProperty(code);
    }
  });

  it("every order/payment/print status enum value is translated", () => {
    const enumValues = (name: string) => {
      const body = sql.match(new RegExp(`create type public\\.${name} as enum \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? "";
      return [...body.replace(/--.*$/gm, "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    for (const [type, ns] of [["order_status", "orderStatus"], ["payment_status", "paymentStatus"], ["print_job_status", "printStatus"]] as const) {
      const values = enumValues(type);
      expect(values.length).toBeGreaterThan(0);
      expect(Object.keys(en[ns]).sort()).toEqual([...values].sort());
      expect(Object.keys(am[ns]).sort()).toEqual([...values].sort());
    }
  });

  it("English and Amharic catalogs have identical keys", () => {
    expect(keysOf(am).sort()).toEqual(keysOf(en).sort());
  });
});

describe("admin context parsing", () => {
  it("drops unknown permissions and rejects unknown roles", () => {
    const ctx = parseAdminContext({ user_id: "u", full_name: "A", role: "staff", permissions: ["orders.view_assigned", "god.mode"] });
    expect([...ctx!.permissions]).toEqual(["orders.view_assigned"]);
    expect(parseAdminContext({ user_id: "u", role: "owner", permissions: [] })).toBeNull();
    expect(parseAdminContext(null)).toBeNull();
  });
});

import { parseLegalText, privacy, terms, toLegalText } from "@/content/legal";

describe("legal text format", () => {
  it("round-trips the default sections", () => {
    const parsed = parseLegalText(toLegalText(terms.en));
    expect(parsed.map((s) => s.heading)).toEqual(terms.en.map((s) => s.heading));
    expect(parseLegalText(toLegalText(privacy.am))).toHaveLength(privacy.am.length);
  });
  it("treats markup as plain text and keeps intro paragraphs", () => {
    const parsed = parseLegalText("Intro line\n\n## Heading <script>x</script>\n\nBody <b>bold</b>");
    expect(parsed[0]).toEqual({ heading: null, paragraphs: ["Intro line"] });
    expect(parsed[1].heading).toBe("Heading <script>x</script>"); // rendered as text by React, never as HTML
  });
});

import { handleFromUrl } from "@/components/shop/social-links";

describe("social handles", () => {
  it.each([
    ["https://instagram.com/abiyeshop", "@abiyeshop"],
    ["https://www.tiktok.com/@abiye.shop", "@abiye.shop"],
    ["https://facebook.com/abiyeshop/", "@abiyeshop"],
    ["https://t.me/abiyeshop", "@abiyeshop"],
    ["https://facebook.com/profile.php?id=123", "Facebook"],
    ["not a url", "Facebook"],
  ])("%s → %s", (url, expected) => expect(handleFromUrl(url, "Facebook")).toBe(expected));
});
