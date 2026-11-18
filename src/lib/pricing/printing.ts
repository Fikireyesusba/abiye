import { addSantim, mulSantim, type Santim } from "@/lib/money";

/**
 * Printing price — mirror of public.quote_printing() for live estimates in the UI.
 *   total = pageCount × copies × pricePerPage(color, size, sides) + serviceCharge
 * Returns null when no automatic price is possible (unknown pages / no rule),
 * in which case the job goes to "Awaiting Quote".
 */
export type PrintColorMode = "bw" | "color";
export type PrintSides = "single" | "double";

export interface PrintPriceRule {
  colorMode: PrintColorMode;
  paperSize: string;
  sides: PrintSides;
  pricePerPage: Santim;
  isActive: boolean;
}

export interface PrintQuoteInput {
  colorMode: PrintColorMode;
  paperSize: string;
  sides: PrintSides;
  pageCount: number | null;
  copies: number;
}

export interface PrintQuote {
  pricePerPage: Santim;
  serviceCharge: Santim;
  printedPages: number;
  sheetsPerCopy: number;
  total: Santim;
}

export function quotePrinting(
  rules: readonly PrintPriceRule[],
  serviceCharge: Santim,
  input: PrintQuoteInput,
): PrintQuote | null {
  const { pageCount, copies } = input;
  if (pageCount === null || !Number.isInteger(pageCount) || pageCount < 1) return null;
  if (!Number.isInteger(copies) || copies < 1) return null;
  const rule = rules.find(
    (r) => r.isActive && r.colorMode === input.colorMode && r.paperSize === input.paperSize && r.sides === input.sides,
  );
  if (!rule) return null;
  const printedPages = pageCount * copies;
  return {
    pricePerPage: rule.pricePerPage,
    serviceCharge,
    printedPages,
    sheetsPerCopy: input.sides === "double" ? Math.ceil(pageCount / 2) : pageCount,
    total: addSantim(mulSantim(rule.pricePerPage, printedPages), serviceCharge),
  };
}
