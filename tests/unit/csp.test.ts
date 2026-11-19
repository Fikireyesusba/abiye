import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

describe("content security policy", () => {
  const prod = buildContentSecurityPolicy({ nonce: "abc123", supabaseUrl: "https://xyz.supabase.co/", dev: false });
  it("allows only nonce'd scripts, no eval or inline scripts", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
  it("allows Supabase for uploads and images, nothing else external", () => {
    expect(prod).toContain("connect-src 'self' https://xyz.supabase.co;");
    expect(prod).toContain("img-src 'self' data: blob: https://xyz.supabase.co;");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("upgrade-insecure-requests");
  });
  it("dev allows eval and HMR websockets; local http Supabase is not upgraded", () => {
    const dev = buildContentSecurityPolicy({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321", dev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(buildContentSecurityPolicy({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321", dev: false })).not.toContain("upgrade-insecure-requests");
  });
});
