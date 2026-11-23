import { afterEach, describe, expect, it, vi } from "vitest";
import { homeSurfaceForRole, pathAllowed, roleAllowedOn, surfaceForHost, surfaceUrl } from "@/lib/security/hosts";

const set = () => {
  vi.stubEnv("CUSTOMER_HOST", "fantaf.xyz");
  vi.stubEnv("STAFF_HOST", "ocs.fantaf.xyz");
  vi.stubEnv("SUPER_ADMIN_HOST", "https://operations.fantaf.xyz/");
  vi.stubEnv("COURIER_HOST", "Courier.Fantaf.xyz");
};

describe("separate addresses", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("not configured (or only partly) → no split: everything allowed", () => {
    expect(surfaceForHost("ocs.fantaf.xyz")).toBeNull();
    vi.stubEnv("STAFF_HOST", "ocs.fantaf.xyz");
    expect(surfaceForHost("ocs.fantaf.xyz")).toBeNull();
    expect(roleAllowedOn(null, "super_admin")).toBe(true);
    expect(surfaceUrl("staff")).toBeNull();
  });

  it("each address serves its own part (ports and letter case ignored; unknown → customer)", () => {
    set();
    expect(surfaceForHost("fantaf.xyz")).toBe("customer");
    expect(surfaceForHost("ocs.fantaf.xyz:443")).toBe("staff");
    expect(surfaceForHost("operations.fantaf.xyz")).toBe("super");
    expect(surfaceForHost("courier.fantaf.xyz")).toBe("courier");
    expect(surfaceForHost("abiye-git-x.vercel.app")).toBe("customer");
    expect(surfaceUrl("super")).toBe("https://operations.fantaf.xyz");
  });

  it("who may sign in where", () => {
    expect(roleAllowedOn("super", "super_admin")).toBe(true);
    expect(roleAllowedOn("super", "manager")).toBe(false);
    expect(roleAllowedOn("staff", "manager")).toBe(true);
    expect(roleAllowedOn("staff", "cashier")).toBe(true); // custom permission sets use the staff address
    expect(roleAllowedOn("staff", "super_admin")).toBe(false);
    expect(roleAllowedOn("staff", "courier")).toBe(false);
    expect(roleAllowedOn("courier", "courier")).toBe(true);
    expect(roleAllowedOn("courier", "manager")).toBe(false);
    expect(roleAllowedOn("customer", "super_admin")).toBe(false);
    expect(homeSurfaceForRole("courier")).toBe("courier");
  });

  it("pages per address", () => {
    expect(pathAllowed("customer", "/admin")).toBe(false);
    expect(pathAllowed("customer", "/courier")).toBe(false);
    expect(pathAllowed("customer", "/shop")).toBe(true);
    expect(pathAllowed("staff", "/admin/orders")).toBe(true);
    expect(pathAllowed("staff", "/")).toBe(false);
    expect(pathAllowed("super", "/account")).toBe(false);
    expect(pathAllowed("courier", "/courier")).toBe(true);
    expect(pathAllowed("courier", "/admin/login")).toBe(true);
    expect(pathAllowed("courier", "/admin/mfa")).toBe(true);
    expect(pathAllowed("courier", "/admin/orders")).toBe(false);
  });
});
