/**
 * Money helpers. The database stores ETB as numeric(12,2). In TypeScript we
 * convert to integer SANTIM (1 Birr = 100 santim) before any arithmetic, so
 * floating-point error can never creep into totals.
 */
export type Santim = number & { readonly __brand: "santim" };

export function toSantim(etb: number | string): Santim {
  const value = typeof etb === "string" ? Number(etb) : etb;
  if (!Number.isFinite(value)) throw new RangeError(`Invalid ETB amount: ${String(etb)}`);
  return Math.round(value * 100) as Santim;
}

export function santim(n: number): Santim {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Santim must be an integer: ${n}`);
  return n as Santim;
}

export function fromSantim(s: Santim): number {
  return s / 100;
}

export function addSantim(...values: Santim[]): Santim {
  return values.reduce((a, b) => a + b, 0) as Santim;
}

export function mulSantim(value: Santim, qty: number): Santim {
  if (!Number.isSafeInteger(qty)) throw new RangeError(`Quantity must be an integer: ${qty}`);
  return (value * qty) as Santim;
}

const fmtWhole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtCents = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 450000 -> "4,500 ETB" (en) / "4,500 ብር" (am). Shows cents only when non-zero. */
export function formatETB(value: Santim, locale: "en" | "am" = "en"): string {
  const birr = value / 100;
  const digits = value % 100 === 0 ? fmtWhole.format(birr) : fmtCents.format(birr);
  return locale === "am" ? `${digits} ብር` : `${digits} ETB`;
}
