import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
  SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz", APP_URL: "https://shop.example", CRON_SECRET: "x".repeat(40),
};
const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("Cloudmersive virus scan (fails closed)", () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("no API key → unavailable (upload refused), nothing sent", async () => {
    const f = answer(200, { CleanResult: true });
    vi.stubGlobal("fetch", f);
    const { scanFile, scanConfigured } = await import("@/lib/security/virus-scan");
    expect(scanConfigured()).toBe(false);
    expect(await scanFile(bytes, "a.pdf", [".pdf"])).toMatchObject({ ok: false, reason: "unavailable" });
    expect(f).not.toHaveBeenCalled();
  });

  it("clean file → ok; strict advanced-scan request", async () => {
    vi.stubEnv("CLOUDMERSIVE_API_KEY", "key-1234567890");
    const f = answer(200, { CleanResult: true });
    vi.stubGlobal("fetch", f);
    const { scanFile } = await import("@/lib/security/virus-scan");
    expect(await scanFile(bytes, "a.pdf", [".pdf"])).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.cloudmersive.com/virus/scan/file/advanced");
    expect(init.headers).toMatchObject({ Apikey: "key-1234567890", allowExecutables: "false", allowScripts: "false", allowMacros: "false",
      allowPasswordProtectedFiles: "false", allowInvalidFiles: "false", allowHtml: "false", restrictFileTypes: ".pdf" });
    expect((init.body as FormData).get("inputFile")).toBeInstanceOf(Blob);
  });

  it("virus or unsafe content → infected, with what was found", async () => {
    vi.stubEnv("CLOUDMERSIVE_API_KEY", "key-1234567890");
    vi.stubGlobal("fetch", answer(200, { CleanResult: false, FoundViruses: [{ VirusName: "EICAR-Test-File" }], ContainsMacros: true, ContainsPasswordProtectedFile: true }));
    const { scanFile } = await import("@/lib/security/virus-scan");
    const r = await scanFile(bytes, "a.pdf", [".pdf"]);
    expect(r).toMatchObject({ ok: false, reason: "infected" });
    expect(r.ok === false && r.reason === "infected" && r.findings).toEqual(["virus: EICAR-Test-File", "contains macros", "is password-protected"]);
  });

  it("wrong key, monthly limit, outage, odd answer, network error → unavailable", async () => {
    vi.stubEnv("CLOUDMERSIVE_API_KEY", "key-1234567890");
    const { scanFile } = await import("@/lib/security/virus-scan");
    for (const f of [answer(401, {}), answer(429, {}), answer(503, {}), answer(200, { Something: 1 }), vi.fn(async () => { throw new Error("ECONNRESET"); })]) {
      vi.stubGlobal("fetch", f);
      expect(await scanFile(bytes, "a.pdf", [".pdf"])).toMatchObject({ ok: false, reason: "unavailable" });
    }
  });
});
