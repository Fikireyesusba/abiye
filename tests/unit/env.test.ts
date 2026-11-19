import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
  SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz", APP_URL: "https://shop.example", CRON_SECRET: "x".repeat(40),
};
const PUB = "B" + "A".repeat(86);
const PRIV = "a".repeat(43);

describe("server environment", () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v); });

  it("tolerates spaces and quotes pasted around optional keys", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", ` "${PUB}" `);
    vi.stubEnv("VAPID_PRIVATE_KEY", `${PRIV}\n`);
    vi.stubEnv("VAPID_SUBJECT", "mailto:orders@shop.example");
    const env = await import("@/lib/env");
    expect(env.getServerEnv().VAPID_PUBLIC_KEY).toBe(PUB);
    expect(env.optionalEnvProblems()).toEqual({});
  });
  it("an invalid optional key switches that feature off instead of breaking the site", async () => {
    vi.stubEnv("VAPID_SUBJECT", "orders@shop.example"); // missing mailto:
    vi.stubEnv("RESEND_API_KEY", "not-a-key");
    const env = await import("@/lib/env");
    expect(env.getServerEnv().APP_URL).toBe("https://shop.example");
    expect(env.getServerEnv().VAPID_SUBJECT).toBeUndefined();
    expect(Object.keys(env.optionalEnvProblems()).sort()).toEqual(["RESEND_API_KEY", "VAPID_SUBJECT"]);
  });
  it("required settings still fail loudly", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    const env = await import("@/lib/env");
    expect(() => env.getServerEnv()).toThrow(/CRON_SECRET/);
  });
});
