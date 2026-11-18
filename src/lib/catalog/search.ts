/**
 * Catalog query parameters arrive from the URL, so they are untrusted.
 * The search term is interpolated into a PostgREST `or=(...)` filter, where
 * commas, parentheses, quotes, dots, colons, asterisks and backslashes are
 * syntax; we keep only letters (incl. Ge'ez/Ethiopic), digits, spaces and
 * hyphens so the term can never alter the filter structure.
 */
export const SORTS = ["newest", "price_asc", "price_desc", "name"] as const;
export type Sort = (typeof SORTS)[number];
export const PAGE_SIZE = 24;

export function sanitizeSearchTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function parseSort(raw: unknown): Sort {
  return typeof raw === "string" && (SORTS as readonly string[]).includes(raw) ? (raw as Sort) : "newest";
}

export function parsePage(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
}

export function parseSlug(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw) && raw.length <= 100 ? raw : null;
}

/** Build the PostgREST `or` filter for a sanitized term. */
export function searchFilter(term: string): string | null {
  if (!term) return null;
  const p = `*${term}*`;
  return ["name_en", "name_am", "brand", "sku"].map((c) => `${c}.ilike.${p}`).join(",");
}

/** Read a single string value from Next.js searchParams. */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
