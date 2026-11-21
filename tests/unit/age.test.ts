import { describe, expect, it } from "vitest";
import { ageFrom, maxBirthDate, personSummary } from "@/lib/age";

describe("age from date of birth", () => {
  const today = new Date("2026-11-21T12:00:00Z");
  it("counts whole years, birthday not yet reached this year", () => {
    expect(ageFrom("1995-11-21", today)).toBe(31);
    expect(ageFrom("1995-11-22", today)).toBe(30);
    expect(ageFrom("", today)).toBeNull();
    expect(ageFrom("nonsense", today)).toBeNull();
  });
  it("summary and the latest allowed birth date", () => {
    expect(personSummary("female", "2000-01-01")).toMatch(/^Female · \d+ years$/);
    expect(personSummary(null, null)).toBe("");
    expect(maxBirthDate(10, today)).toBe("2016-11-21");
  });
});
