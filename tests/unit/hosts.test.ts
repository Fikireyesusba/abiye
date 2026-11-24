import { afterEach, describe, expect, it, vi } from "vitest";
import { homeSurfaceForRole, pathAllowed, roleAllowedOn, surfaceForHost, surfaceUrl } from "@/lib/security/hosts";

const set = () => {
  vi.stubEnv("CUSTOMER_HOST", "abiye.site");
  vi.stubEnv("STAFF_HOST", "ocs.abiye.site");
  vi.stubEnv("SUPER_ADMIN_HOST", "https://operations.abiye.site/");
  vi.stubEnv("COURIER_HOST", "Courier.Abiye.Site");
};

describe("separate addresses", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("not configured (or only partly) → no split: everything allowed", () => {
    expect(surfaceForHost("ocs.abiye.site")).toBeNull();
    vi.stubEnv("STAFF_HOST", "ocs.abiye.site");
    expect(surfaceForHost("ocs.abiye.site")).toBeNull();
    expect(roleAllowedOn(null, "super_admin")).toBe(true);
    expect(surfaceUrl("staff")).toBeNull();
  });

  it("each address serves its own part (ports and letter case ignored; unknown → customer)", () => {
    set();
    expect(surfaceForHost("abiye.site")).toBe("customer");
    expect(surfaceForHost("ocs.abiye.site:443")).toBe("staff");
    expect(surfaceForHost("operations.abiye.site")).toBe("super");
    expect(surfaceForHost("courier.abiye.site")).toBe("courier");
    expect(surfaceForHost("abiye-git-x.vercel.app")).toBe("customer");
    expect(surfaceUrl("super")).toBe("https://operations.abiye.site");
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

describe("Abiye Business address (partner shops)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("without BUSINESS_HOST: partner shops use the courier address", () => {
    set();
    expect(roleAllowedOn("courier", "partner")).toBe(true);
    expect(pathAllowed("courier", "/business")).toBe(true);
    expect(homeSurfaceForRole("partner")).toBe("courier");
    expect(roleAllowedOn("staff", "partner")).toBe(false);
    expect(pathAllowed("customer", "/business")).toBe(false);
  });
  it("with BUSINESS_HOST: its own address, couriers and partners apart", () => {
    set();
    vi.stubEnv("BUSINESS_HOST", "business.abiye.site");
    expect(surfaceForHost("business.abiye.site")).toBe("business");
    expect(roleAllowedOn("business", "partner")).toBe(true);
    expect(roleAllowedOn("business", "courier")).toBe(false);
    expect(roleAllowedOn("courier", "partner")).toBe(false);
    expect(pathAllowed("courier", "/business")).toBe(false);
    expect(pathAllowed("business", "/business/earnings")).toBe(true);
    expect(pathAllowed("business", "/admin/login")).toBe(true);
    expect(pathAllowed("business", "/courier")).toBe(false);
    expect(homeSurfaceForRole("partner")).toBe("business");
    expect(surfaceUrl("business")).toBe("https://business.abiye.site");
  });
});
