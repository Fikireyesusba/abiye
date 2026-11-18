import { describe, expect, it } from "vitest";
import { first, parsePage, parseSlug, parseSort, sanitizeSearchTerm, searchFilter } from "@/lib/catalog/search";

describe("catalog search sanitization", () => {
  it("keeps English, Amharic, digits, spaces and hyphens", () => {
    expect(sanitizeSearchTerm("  USB-C   charger 25W ")).toBe("USB-C charger 25W");
    expect(sanitizeSearchTerm("ሽቶ")).toBe("ሽቶ");
  });

  it.each([
    "a),status.eq.draft,(name_en.ilike.*",
    'x" or 1=1 --',
    "*%_\\:.,()",
    "<script>alert(1)</script>",
  ])("strips PostgREST/SQL syntax from %s", (raw) => {
    const term = sanitizeSearchTerm(raw);
    expect(term).not.toMatch(/[(),.*:"'%\\<>]/);
    const filter = searchFilter(term);
    if (filter) expect(filter.split(",")).toHaveLength(4); // exactly the 4 intended conditions
  });

  it("limits length and rejects non-strings", () => {
    expect(sanitizeSearchTerm("a".repeat(500))).toHaveLength(60);
    expect(sanitizeSearchTerm(["x"])).toBe("");
    expect(searchFilter("")).toBeNull();
  });

  it("builds a four-column ilike filter", () => {
    expect(searchFilter("oud")).toBe("name_en.ilike.*oud*,name_am.ilike.*oud*,brand.ilike.*oud*,sku.ilike.*oud*");
  });
});

describe("catalog URL params", () => {
  it("whitelists sort values", () => {
    expect(parseSort("price_asc")).toBe("price_asc");
    expect(parseSort("price_asc;drop")).toBe("newest");
    expect(parseSort(undefined)).toBe("newest");
  });
  it("bounds page numbers", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-5")).toBe(1);
    expect(parsePage("99999")).toBe(1);
    expect(parsePage("abc")).toBe(1);
  });
  it("validates slugs", () => {
    expect(parseSlug("power-banks")).toBe("power-banks");
    expect(parseSlug("../admin")).toBeNull();
    expect(parseSlug("Power Banks")).toBeNull();
    expect(first(["a", "b"])).toBe("a");
  });
});
