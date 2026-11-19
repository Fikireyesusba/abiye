import { describe, expect, it } from "vitest";
import { safeAdminRedirect } from "@/lib/auth/safe-redirect";

describe("admin login redirect", () => {
  it.each(["/admin", "/admin/orders", "/admin/orders/abc-123", "/admin/orders?status=pending_verification"])("allows %s", (p) => {
    expect(safeAdminRedirect(p)).toBe(p);
  });
  it.each([
    "https://evil.com", "//evil.com", "/\\evil.com", "/admin//evil.com/..", "/shop", "javascript:alert(1)",
    "/admin/../../etc", "/admin%2F%2Fevil.com", "/admin/login", undefined, ["/admin"],
  ])("rejects %s", (p) => {
    expect(safeAdminRedirect(p)).toBe("/admin");
  });
});

import { parseOrderSearch } from "@/lib/admin/search";

describe("admin order search parsing", () => {
  it.each([
    ["ET-10025", { kind: "number", value: "ET-10025" }],
    ["et 10025", { kind: "number", value: "ET-10025" }],
    ["10025", { kind: "number", value: "ET-10025" }],
    ["0911 22 33 44", { kind: "phone", value: "+251911223344" }],
    ["Abebe", { kind: "name", value: "Abebe" }],
    ["a),status.eq.x", { kind: "name", value: "a status eq x" }],
  ])("%s", (input, expected) => {
    expect(parseOrderSearch(input)).toEqual(expected);
  });
  it("ignores empty/short input", () => {
    expect(parseOrderSearch("")).toBeNull();
    expect(parseOrderSearch("*")).toBeNull();
  });
});

import { safeNext } from "@/lib/account/session";

describe("customer sign-in redirect", () => {
  it.each(["/account", "/checkout", "/printing/jobs/abc", "/order-success/x?y=1"])("allows %s", (p) => expect(safeNext(p)).toBe(p));
  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "/admin", "/admin/orders", "/a/../admin", "javascript:x", undefined])("rejects %s", (p) =>
    expect(safeNext(p)).toBe("/account"));
});
