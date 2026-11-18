import { describe, expect, it } from "vitest";
import { generateAccessToken, generateTrackingCode, normalizeTrackingCode, safeEqualHex, sha256Hex } from "@/lib/security/tokens";
import { buildStoragePath, detectFileType, validateUpload, RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/validation/upload";
import { AppError, toAppError } from "@/lib/errors";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);

describe("access tokens", () => {
  it("generates 256-bit url-safe tokens that match the checkout schema", () => {
    const t = generateAccessToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 200 }, generateAccessToken)).size).toBe(200);
  });
  it("hashes to the 64-hex format stored in the database", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("tracking codes are typeable and normalize ambiguous characters", () => {
    const code = generateTrackingCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalizeTrackingCode(code.toLowerCase().replace("-", " "))).toBe(code);
    expect(normalizeTrackingCode("ab1oi-23456")).toBe("AB101-23456");
    expect(normalizeTrackingCode("short")).toBeNull();
    expect(normalizeTrackingCode("'; drop table orders;--")).toBeNull();
  });
  it("compares hashes in constant time and rejects malformed input", () => {
    const h = sha256Hex("x");
    expect(safeEqualHex(h, sha256Hex("x"))).toBe(true);
    expect(safeEqualHex(h, sha256Hex("y"))).toBe(false);
    expect(safeEqualHex(h, "zz")).toBe(false);
  });
});

describe("upload validation (by content, not by claimed type)", () => {
  it("detects real file types from magic bytes", () => {
    expect(detectFileType(JPEG)).toBe("image/jpeg");
    expect(detectFileType(PNG)).toBe("image/png");
    expect(detectFileType(PDF)).toBe("application/pdf");
    expect(detectFileType(HTML)).toBeNull();
    expect(detectFileType(ZIP, "evil.zip")).toBeNull();
    expect(detectFileType(ZIP, "thesis.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
  it("accepts JPG/PNG/PDF receipts only", () => {
    expect(validateUpload(PDF, { allowed: RECEIPT_TYPES, maxBytes: RECEIPT_MAX_BYTES })).toEqual({ ok: true, type: "application/pdf", extension: "pdf" });
    expect(validateUpload(HTML, { allowed: RECEIPT_TYPES, maxBytes: RECEIPT_MAX_BYTES })).toEqual({ ok: false, reason: "unsupported_type" });
    expect(validateUpload(ZIP, { allowed: RECEIPT_TYPES, maxBytes: RECEIPT_MAX_BYTES, originalName: "x.docx" }).ok).toBe(false);
  });
  it("enforces size limits", () => {
    expect(validateUpload(new Uint8Array(0), { allowed: RECEIPT_TYPES, maxBytes: 10 })).toEqual({ ok: false, reason: "empty" });
    expect(validateUpload(JPEG, { allowed: RECEIPT_TYPES, maxBytes: 5 })).toEqual({ ok: false, reason: "too_large" });
  });
  it("builds server-generated storage paths that ignore user file names", () => {
    expect(buildStoragePath("orders/abc", "pdf")).toMatch(/^orders\/abc\/[0-9a-f-]{36}\.pdf$/);
    expect(() => buildStoragePath("../etc", "pdf")).toThrow();
  });
});

describe("database error mapping", () => {
  it("maps app_error codes raised by Postgres functions", () => {
    const e = toAppError({ code: "P0001", message: "out_of_stock", details: "20000000-0000-0000-0000-000000000001" });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("out_of_stock");
    expect(e.detail).toBe("20000000-0000-0000-0000-000000000001");
  });
  it("hides unknown/internal errors", () => {
    expect(toAppError({ code: "42501", message: "permission denied for table orders" }).code).toBe("unexpected");
    expect(toAppError(new Error("boom")).code).toBe("unexpected");
  });
});
