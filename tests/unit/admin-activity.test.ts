import { describe, expect, it } from "vitest";
import { actionLabel, describeChanges, waitingFor } from "@/lib/admin/activity";
import { fromAddisInput, toAddisInput } from "@/lib/datetime";

describe("activity labels", () => {
  it("labels known actions and falls back to readable text", () => {
    expect(actionLabel("customer_deactivated")).toBe("Account deactivated");
    expect(actionLabel("something_new")).toBe("something new");
  });
});

describe("describeChanges", () => {
  it("lists only changed fields and hides timestamps", () => {
    expect(describeChanges({ price_etb: 100, name_en: "A", updated_at: "x" }, { price_etb: 120, name_en: "A", updated_at: "y" }))
      .toEqual(["price_etb: 100 → 120"]);
  });
  it("shows set values for inserts and deletes", () => {
    expect(describeChanges(null, { name: "CBE", note: null })).toEqual(["name: CBE"]);
    expect(describeChanges({ name: "CBE" }, null)).toEqual(["name: CBE"]);
  });
  it("renders empty values and truncates long lists", () => {
    expect(describeChanges({ phone: null }, { phone: "+251911000111" })).toEqual(["phone: — → +251911000111"]);
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    expect(describeChanges(null, many, 5)).toHaveLength(6);
  });
});

describe("waitingFor", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  it("formats minutes, hours and days", () => {
    expect(waitingFor("2026-11-19T11:30:00Z", now)).toBe("30 min");
    expect(waitingFor("2026-11-19T09:00:00Z", now)).toBe("3 h");
    expect(waitingFor("2026-11-15T12:00:00Z", now)).toBe("4 d");
  });
});

describe("Addis Ababa datetime inputs", () => {
  it("round-trips through UTC+3", () => {
    expect(fromAddisInput("2026-11-20T09:00")).toBe("2026-11-20T06:00:00.000Z");
    expect(toAddisInput("2026-11-20T06:00:00.000Z")).toBe("2026-11-20T09:00");
    expect(fromAddisInput("")).toBeNull();
    expect(fromAddisInput("nonsense")).toBeNull();
  });
});
