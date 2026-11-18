import { describe, expect, it } from "vitest";
import { formatEthiopianPhone, normalizeEthiopianPhone } from "@/lib/validation/phone";

describe("Ethiopian phone normalization", () => {
  it.each([
    ["0911223344", "+251911223344"],
    ["0911 22 33 44", "+251911223344"],
    ["911223344", "+251911223344"],
    ["251911223344", "+251911223344"],
    ["+251911223344", "+251911223344"],
    ["+251 91 122 3344", "+251911223344"],
    ["00251911223344", "+251911223344"],
    ["(091) 122-3344", "+251911223344"],
    ["0712345678", "+251712345678"], // Safaricom Ethiopia
  ])("accepts %s", (input, expected) => {
    expect(normalizeEthiopianPhone(input)).toBe(expected);
  });

  it.each([
    "", "abc", "0811223344", "091122334", "09112233445", "+254711223344", "+1 911 223 3344",
    "0111223344", // landline
    "09112233a4", "+251-91-122-33-44-5",
  ])("rejects %s", (input) => {
    expect(normalizeEthiopianPhone(input)).toBeNull();
  });

  it("matches the database CHECK constraint format", () => {
    expect(normalizeEthiopianPhone("0911223344")).toMatch(/^\+251[79][0-9]{8}$/);
  });

  it("formats for display", () => {
    expect(formatEthiopianPhone("+251911223344")).toBe("+251 91 122 3344");
  });
});
